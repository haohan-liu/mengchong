import "./styles.css";
import "./pet-overrides.css";
import { PetApp } from "./renderer/App";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("找不到应用根节点");
const app = new PetApp(root);
void app.mount();
