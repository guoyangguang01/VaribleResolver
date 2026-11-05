import ProgramLauncher from "./components/ProgramLauncher";

function App() {
  const isDesktop = Boolean(window.programStudio?.isDesktop);

  return (
    <div className="app-shell client-app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="site-header client-header">
        <a className="brand" href="#workspace" aria-label="Program Studio 首页">
          <span className="brand-mark">P:</span>
          <span className="brand-name">
            Program <strong>Studio</strong>
          </span>
        </a>
        <div className="privacy-note">
          <span className="privacy-dot" />
          {isDesktop
            ? "桌面客户端 · 本机路径读写"
            : "浏览器预览 · 桌面客户端能力未连接"}
        </div>
        <span className="client-version">CLIENT / 0.2</span>
      </header>

      <main className="client-main" id="workspace">
        <ProgramLauncher />
      </main>

      <footer>
        <span>Program Studio</span>
        <p>程序启动 · 参数管理 · 本机文件处理</p>
        <span>2026 / CLIENT</span>
      </footer>
    </div>
  );
}

export default App;
