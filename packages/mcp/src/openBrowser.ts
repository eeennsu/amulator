import { spawn, type SpawnOptions } from 'node:child_process';

// Only the bridge's own page URLs are ever opened. This also keeps shell metacharacters out of cmd.exe.
const PAGE_URL = /^http:\/\/127\.0\.0\.1:\d+\/\?[\w=&.-]+$/;

const launcher = (url: string): { command: string; args: string[]; options: SpawnOptions } => {
  const options: SpawnOptions = { detached: true, stdio: 'ignore' };
  if (process.platform === 'win32') {
    // `start` takes the first quoted argument as a window title, so pass an empty one. The URL is
    // quoted because an unquoted `&` would end the cmd.exe command; verbatim keeps those quotes.
    return {
      command: 'cmd',
      args: ['/c', 'start', '""', `"${url}"`],
      options: { ...options, windowsVerbatimArguments: true },
    };
  }
  return { command: process.platform === 'darwin' ? 'open' : 'xdg-open', args: [url], options };
};

// Fire and forget: a missing browser must not fail the tool call, so problems only go to stderr.
export const openBrowser = (url: string): void => {
  if (!PAGE_URL.test(url)) {
    console.error('openBrowser: refused to open an unexpected URL');
    return;
  }
  const { command, args, options } = launcher(url);
  const child = spawn(command, args, options);
  child.on('error', (error) => console.error(`openBrowser: ${error.message}`));
  child.unref();
};
