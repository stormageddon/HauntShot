import { listen } from "@tauri-apps/api/event";
import "./toast.css";

type ToastPayload = {
  tone: "ok" | "error";
  title: string;
  detail?: string;
};

const card = document.getElementById("toast") as HTMLDivElement;
const title = card.querySelector(".title") as HTMLDivElement;
const detail = card.querySelector(".detail") as HTMLDivElement;

void listen<ToastPayload>("toast", ({ payload }) => {
  card.classList.toggle("error", payload.tone === "error");
  title.textContent = payload.title;
  detail.textContent = payload.detail ?? "";
});
