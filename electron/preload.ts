import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("mydbtoolDesktop", {
  isDesktop: true,
});
