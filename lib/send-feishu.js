import https from "https";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function loadEnv() {
  const envFile = join(homedir(), ".config", "opencode", "skills", "feishu-message", ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const idx = trimmed.indexOf("=");
        const k = trimmed.slice(0, idx);
        let v = trimmed.slice(idx + 1);
        if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith("\"") && v.endsWith("\""))) {
          v = v.slice(1, -1);
        }
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}

loadEnv();

const APP_ID = process.env.FEISHU_OPENCODE_APP_ID;
const APP_SECRET = process.env.FEISHU_OPENCODE_APP_SECRET;
const OPEN_ID = process.env.FEISHU_OPENCODE_OPEN_ID;

export function sendFeishuText(text) {
  if (!APP_ID || !APP_SECRET || !OPEN_ID) {
    console.warn("[feishu] missing credentials");
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "open.feishu.cn",
      path: "/open-apis/auth/v3/tenant_access_token/internal",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try {
          const token = JSON.parse(data).tenant_access_token;
          if (!token) { console.warn("[feishu] no token"); resolve(); return; }
          const msg = JSON.stringify({
            receive_id: OPEN_ID,
            msg_type: "text",
            content: JSON.stringify({ text }),
          });
          const req2 = https.request({
            hostname: "open.feishu.cn",
            path: "/open-apis/im/v1/messages?receive_id_type=open_id",
            method: "POST",
            headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
          }, (res2) => {
            let body = "";
            res2.on("data", d => body += d);
            res2.on("end", () => {
              try {
                const j = JSON.parse(body);
                if (j.code === 0) console.log("[feishu] sent ok");
                else console.warn("[feishu]", j.code, j.msg);
              } catch { console.warn("[feishu] response parse failed"); }
              resolve();
            });
          });
          req2.on("error", () => resolve());
          req2.write(msg);
          req2.end();
        } catch { resolve(); }
      });
    });
    req.on("error", () => resolve());
    req.write(JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }));
    req.end();
  });
}

if (process.argv[2]) {
  sendFeishuText(process.argv[2]).then(() => process.exit(0));
}
