using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Windows compatibility sidecar used only when the Rust toolchain is unavailable.
// Keyboard callbacks count key-down events and intentionally never inspect virtual
// key codes, scan codes, characters, or text.
internal static class PetSensorCompat
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_MOUSEMOVE = 0x0200;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_MBUTTONDOWN = 0x0207;
    private const int WM_MOUSEWHEEL = 0x020A;
    private const int WM_XBUTTONDOWN = 0x020B;
    private const uint MONITOR_DEFAULTTONEAREST = 2;
    private const uint DESKTOP_READOBJECTS = 0x0001;

    private static long keyCount;
    private static long clickCount;
    private static long wheelCount;
    private static long moveDistance;
    private static long lastX = long.MinValue;
    private static long lastY = long.MinValue;
    private static readonly HookProc KeyboardProc = KeyboardHook;
    private static readonly HookProc MouseProc = MouseHook;

    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseHookData { public Point Point; public uint MouseData; public uint Flags; public uint Time; public UIntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct LastInputInfo { public uint Size; public uint Time; }
    [StructLayout(LayoutKind.Sequential)] private struct Message { public IntPtr Window; public uint Value; public UIntPtr WParam; public IntPtr LParam; public uint Time; public Point Point; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)] private struct MonitorInfo { public uint Size; public Rect Monitor; public Rect Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] private struct PowerStatus { public byte AcLineStatus; public byte BatteryFlag; public byte BatteryPercent; public byte Reserved; public uint BatteryLifeTime; public uint BatteryFullLifeTime; }

    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInputInfo info);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)] private static extern IntPtr GetModuleHandle(string moduleName);
    [DllImport("kernel32.dll")] private static extern uint GetTickCount();
    [DllImport("kernel32.dll")] private static extern bool GetSystemPowerStatus(out PowerStatus status);

    private sealed class ForegroundInfo
    {
        public uint ProcessId;
        public string Name = "unknown";
        public string Path = "";
        public string Title = "";
        public bool Fullscreen;
    }

    private static IntPtr KeyboardHook(int code, IntPtr wParam, IntPtr lParam)
    {
        int message = wParam.ToInt32();
        if (code >= 0 && (message == WM_KEYDOWN || message == WM_SYSKEYDOWN))
            Interlocked.Increment(ref keyCount);
        return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    private static IntPtr MouseHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            int message = wParam.ToInt32();
            if (message == WM_LBUTTONDOWN || message == WM_RBUTTONDOWN || message == WM_MBUTTONDOWN || message == WM_XBUTTONDOWN)
                Interlocked.Increment(ref clickCount);
            else if (message == WM_MOUSEWHEEL)
                Interlocked.Increment(ref wheelCount);
            else if (message == WM_MOUSEMOVE)
            {
                MouseHookData data = (MouseHookData)Marshal.PtrToStructure(lParam, typeof(MouseHookData));
                long oldX = Interlocked.Exchange(ref lastX, data.Point.X);
                long oldY = Interlocked.Exchange(ref lastY, data.Point.Y);
                if (oldX != long.MinValue)
                {
                    double dx = data.Point.X - oldX;
                    double dy = data.Point.Y - oldY;
                    Interlocked.Add(ref moveDistance, (long)Math.Sqrt(dx * dx + dy * dy));
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    private static ForegroundInfo ReadForeground()
    {
        ForegroundInfo result = new ForegroundInfo();
        IntPtr window = GetForegroundWindow();
        if (window == IntPtr.Zero) return result;
        uint pid;
        GetWindowThreadProcessId(window, out pid);
        result.ProcessId = pid;
        StringBuilder title = new StringBuilder(2048);
        GetWindowText(window, title, title.Capacity);
        result.Title = title.ToString();
        try
        {
            using (Process process = Process.GetProcessById((int)pid))
            {
                result.Name = process.ProcessName + ".exe";
                try { result.Path = process.MainModule.FileName; } catch { result.Path = ""; }
            }
        }
        catch { }
        Rect rect;
        if (GetWindowRect(window, out rect))
        {
            IntPtr monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
            MonitorInfo info = new MonitorInfo();
            info.Size = (uint)Marshal.SizeOf(typeof(MonitorInfo));
            if (GetMonitorInfo(monitor, ref info))
                result.Fullscreen = rect.Left <= info.Monitor.Left && rect.Top <= info.Monitor.Top && rect.Right >= info.Monitor.Right && rect.Bottom >= info.Monitor.Bottom;
        }
        return result;
    }

    private static long ReadIdleSeconds()
    {
        LastInputInfo info = new LastInputInfo();
        info.Size = (uint)Marshal.SizeOf(typeof(LastInputInfo));
        return GetLastInputInfo(ref info) ? unchecked((uint)(GetTickCount() - info.Time)) / 1000L : 0L;
    }

    private static bool IsLocked()
    {
        IntPtr desktop = OpenInputDesktop(0, false, DESKTOP_READOBJECTS);
        if (desktop == IntPtr.Zero) return true;
        CloseDesktop(desktop);
        return false;
    }

    private static bool IsMeeting(string name)
    {
        string value = (name ?? "").ToLowerInvariant();
        string[] names = { "teams", "zoom", "wechat", "dingtalk", "feishu", "skype", "webex" };
        foreach (string item in names) if (value.Contains(item)) return true;
        return false;
    }

    private static string Json(string value)
    {
        if (value == null) return "\"\"";
        StringBuilder result = new StringBuilder(value.Length + 2);
        result.Append('"');
        foreach (char character in value)
        {
            switch (character)
            {
                case '"': result.Append("\\\""); break;
                case '\\': result.Append("\\\\"); break;
                case '\n': result.Append("\\n"); break;
                case '\r': result.Append("\\r"); break;
                case '\t': result.Append("\\t"); break;
                default:
                    if (character < 32) result.Append("\\u" + ((int)character).ToString("x4"));
                    else result.Append(character);
                    break;
            }
        }
        result.Append('"');
        return result.ToString();
    }

    private static void Push(Queue<long> queue, long value)
    {
        queue.Enqueue(value);
        while (queue.Count > 10) queue.Dequeue();
    }

    private static long Sum(Queue<long> queue)
    {
        long result = 0;
        foreach (long value in queue) result += value;
        return result;
    }

    private static void WriteSnapshots()
    {
        Queue<long> keyboard = new Queue<long>();
        Queue<long> clicks = new Queue<long>();
        Queue<long> wheels = new Queue<long>();
        Queue<long> distances = new Queue<long>();
        Queue<DateTime> switches = new Queue<DateTime>();
        uint activePid = 0;
        DateTime activeSince = DateTime.UtcNow;
        DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        while (true)
        {
            Thread.Sleep(1000);
            long keysNow = Interlocked.Exchange(ref keyCount, 0);
            long clicksNow = Interlocked.Exchange(ref clickCount, 0);
            long wheelsNow = Interlocked.Exchange(ref wheelCount, 0);
            long distanceNow = Interlocked.Exchange(ref moveDistance, 0);
            Push(keyboard, keysNow); Push(clicks, clicksNow); Push(wheels, wheelsNow); Push(distances, distanceNow);
            ForegroundInfo foreground = ReadForeground();
            if (foreground.ProcessId != activePid)
            {
                if (activePid != 0) switches.Enqueue(DateTime.UtcNow);
                activePid = foreground.ProcessId;
                activeSince = DateTime.UtcNow;
            }
            while (switches.Count > 0 && (DateTime.UtcNow - switches.Peek()).TotalMinutes > 5) switches.Dequeue();
            PowerStatus power;
            bool hasPower = GetSystemPowerStatus(out power);
            int battery = hasPower && power.BatteryPercent != 255 ? power.BatteryPercent : 100;
            bool charging = !hasPower || power.AcLineStatus == 1;
            bool meeting = IsMeeting(foreground.Name);
            double sensorMemory = Process.GetCurrentProcess().WorkingSet64 / 1048576.0;
            long timestamp = (long)(DateTime.UtcNow - epoch).TotalMilliseconds;
            string line = "{" +
                "\"timestamp\":" + timestamp + "," +
                "\"foregroundProcess\":" + Json(foreground.Name) + "," +
                "\"foregroundPath\":" + Json(foreground.Path) + "," +
                "\"windowTitle\":" + Json(foreground.Title) + "," +
                "\"documentTitle\":" + Json(foreground.Title) + "," +
                "\"appCategory\":\"other\"," +
                "\"activeAppSeconds\":" + Math.Max(0, (long)(DateTime.UtcNow - activeSince).TotalSeconds) + "," +
                "\"appSwitches5m\":" + switches.Count + "," +
                "\"keyboardCount1s\":" + keysNow + ",\"keyboardCount10s\":" + Sum(keyboard) + ",\"keyboardPulse\":" + (keysNow > 0 ? "true" : "false") + "," +
                "\"mouseClicks1s\":" + clicksNow + ",\"mouseClicks10s\":" + Sum(clicks) + ",\"mouseClickPulse\":" + (clicksNow > 0 ? "true" : "false") + "," +
                "\"mouseWheel1s\":" + wheelsNow + ",\"mouseWheel10s\":" + Sum(wheels) + "," +
                "\"mouseDistance1s\":" + distanceNow + ",\"mouseDistance10s\":" + Sum(distances) + "," +
                "\"idleSeconds\":" + ReadIdleSeconds() + ",\"fullscreen\":" + (foreground.Fullscreen ? "true" : "false") + ",\"locked\":" + (IsLocked() ? "true" : "false") + "," +
                "\"meeting\":" + (meeting ? "true" : "false") + ",\"microphoneActive\":" + (meeting ? "true" : "false") + "," +
                "\"online\":" + (NetworkInterface.GetIsNetworkAvailable() ? "true" : "false") + ",\"batteryPercent\":" + battery + ",\"charging\":" + (charging ? "true" : "false") + "," +
                "\"sensorSource\":\"compat\",\"sensorMemoryMb\":" + sensorMemory.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + "}";
            Console.WriteLine(line);
            Console.Out.Flush();
        }
    }

    private static int Main()
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        IntPtr module = GetModuleHandle(null);
        IntPtr keyboard = SetWindowsHookEx(WH_KEYBOARD_LL, KeyboardProc, module, 0);
        IntPtr mouse = SetWindowsHookEx(WH_MOUSE_LL, MouseProc, module, 0);
        if (keyboard == IntPtr.Zero || mouse == IntPtr.Zero) return 2;
        // Do not report a healthy compatibility source until both global hooks exist.
        Thread writer = new Thread(WriteSnapshots);
        writer.IsBackground = true;
        writer.Start();
        Message message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
        UnhookWindowsHookEx(keyboard);
        UnhookWindowsHookEx(mouse);
        GC.KeepAlive(KeyboardProc);
        GC.KeepAlive(MouseProc);
        return 0;
    }
}
