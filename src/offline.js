export async function registerOffline({ onReady, onError, onUpdate }) {
  if (!('serviceWorker' in navigator)) {
    onError('This browser does not support offline installation. Local label storage still works.');
    return;
  }
  if (import.meta.env.DEV) {
    onError('Offline installation is available in the production build, not the development server.');
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, { scope: import.meta.env.BASE_URL });
    const showUpdate = () => {
      if (registration.waiting && registration.active) onUpdate(() => registration.waiting?.postMessage('ACTIVATE_UPDATE'));
    };
    showUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') showUpdate();
        if (worker.state === 'redundant') onError('Offline cache could not be prepared. Reconnect and reload to retry.');
      });
    });
    await navigator.serviceWorker.ready;
    onReady();
  } catch (error) {
    onError(`Offline setup failed: ${error.message}. Reconnect and reload to retry.`);
  }
}
