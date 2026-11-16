import type RemoteStorage from "remotestoragejs";

// Start provider OAuth from one registered callback, even on a nested app route.
// The provider name is kept only until the canonical app page resumes sign-in.
export function configureProviderRedirects(rs: RemoteStorage, callbackPath = '/', browser = window) {
  const pendingKey = 'pondersource:pending-storage-provider';
  const wrapped = new WeakSet();
  function prepare() {
    for (const provider of ['googledrive', 'dropbox']) {
      const backend = rs[provider as 'googledrive' | 'dropbox'];
      if (!backend || wrapped.has(backend)) continue;
      const connect = backend.connect.bind(backend);
      backend.connect = async () => {
        if (browser.location.pathname !== callbackPath) {
          browser.sessionStorage.setItem(pendingKey, provider);
          browser.location.assign(callbackPath);
          return;
        }
        return connect();
      };
      wrapped.add(backend);
    }
  }
  prepare();
  rs.on('features-loaded', prepare);
  rs.on('ready', () => {
    prepare();
    const provider = browser.sessionStorage.getItem(pendingKey);
    if (browser.location.pathname !== callbackPath ||
        (provider !== 'googledrive' && provider !== 'dropbox')) return;
    browser.sessionStorage.removeItem(pendingKey);
    if (rs.apiKeys[provider] && rs[provider]) {
      Promise.resolve().then(() => rs[provider].connect()).catch(console.error);
    }
  });
}
