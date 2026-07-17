# pet-sensor

Windows x64 Rust sidecar。它安装低级键盘/鼠标钩子，但键盘回调不会读取虚拟键码或字符，只增加计数；每秒向 stdout 输出一行 `ActivitySnapshot` JSON。

```powershell
rustup default stable-x86_64-pc-windows-msvc
cargo build --release --manifest-path native/sensor/Cargo.toml
```

生成文件：`native/sensor/target/release/pet-sensor.exe`。主进程最多退避重启三次，之后自动进入 Electron fallback。
