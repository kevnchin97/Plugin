import { fetchBoards, getSettings, setSettings } from "./api";
import "./ui.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  const s = await getSettings();
  const base = $<HTMLInputElement>("base");
  const token = $<HTMLInputElement>("token");
  const status = $("status");
  base.value = s.baseUrl || "http://localhost:3000";
  token.value = s.token;

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    status.className = "status";
    status.textContent = "Checking…";
    let origin: string;
    try {
      origin = new URL(base.value.trim()).origin;
    } catch {
      status.textContent = "That address doesn't look right.";
      status.className = "status error";
      return;
    }
    // localhost is granted in the manifest; anything else asks for access to just that origin.
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) {
        status.textContent = "The extension needs permission to talk to your Innovate address.";
        status.className = "status error";
        return;
      }
    }
    await setSettings({ baseUrl: origin, token: token.value.trim() });
    try {
      const { recent, boards } = await fetchBoards();
      status.textContent = `Connected. ${recent.length + boards.length} boards available.`;
      status.className = "status ok";
    } catch (err) {
      status.textContent = (err as Error).message;
      status.className = "status error";
    }
  });
}

void main();
