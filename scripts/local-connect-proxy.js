import http from "node:http";
import net from "node:net";

const host = process.env.PROXY_HOST || "127.0.0.1";
const port = Number(process.env.PROXY_PORT || 18888);
const upstreamProxy = parseProxy(
  process.env.UPSTREAM_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    ""
);

const server = http.createServer((req, res) => {
  const message = {
    ok: true,
    proxy: "connect",
    host,
    port
  };
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(message));
});

server.on("connect", (req, clientSocket, head) => {
  const [targetHost, targetPortText] = String(req.url || "").split(":");
  const targetPort = Number(targetPortText || 443);
  const handleReady = (upstream) => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  };

  const upstream = upstreamProxy
    ? connectViaProxy(upstreamProxy, targetHost, targetPort, handleReady, clientSocket)
    : net.connect(targetPort, targetHost, () => handleReady(upstream));

  const closeBoth = () => {
    if (!clientSocket.destroyed) clientSocket.destroy();
    if (!upstream.destroyed) upstream.destroy();
  };

  upstream.on("error", closeBoth);
  clientSocket.on("error", closeBoth);
});

server.listen(port, host, () => {
  console.log(`proxy listening on http://${host}:${port}`);
});

function connectViaProxy(proxy, targetHost, targetPort, onReady, clientSocket) {
  const socket = net.connect(proxy.port, proxy.host, () => {
    socket.write(
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: Keep-Alive\r\nConnection: Keep-Alive\r\n\r\n`
    );
  });

  let buffer = "";
  const onData = (chunk) => {
    buffer += chunk.toString("latin1");
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    socket.off("data", onData);
    const statusLine = buffer.slice(0, buffer.indexOf("\r\n"));
    if (!statusLine.includes(" 200 ")) {
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      clientSocket.destroy();
      socket.destroy();
      return;
    }
    const remainder = Buffer.from(buffer.slice(headerEnd + 4), "latin1");
    onReady(socket);
    if (remainder.length) socket.unshift(remainder);
  };

  socket.on("data", onData);
  return socket;
}

function parseProxy(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return {
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80))
    };
  } catch {
    return null;
  }
}
