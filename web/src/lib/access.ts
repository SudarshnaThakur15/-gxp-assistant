// The hosted demo's access gate. The cookie holds a hash of the code, so changing the code signs everyone out.
export const ACCESS_COOKIE = "demo_access";

export async function accessToken(code: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gxp-demo-access:${code}`));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
