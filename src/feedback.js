export function createFeedback(getPreferences, onError) {
  let audio;
  const active = new Set();
  const Audio = window.AudioContext || window.webkitAudioContext;
  const support = { sound: Boolean(Audio), vibration: typeof navigator.vibrate === 'function' };

  function stop() {
    try {
      for (const oscillator of active) oscillator.stop();
      if (support.vibration) navigator.vibrate(0);
    } catch (error) { onError(`Feedback could not stop: ${error.message}.`); }
  }

  async function unlock() {
    if (!getPreferences().sound || !support.sound) return;
    try {
      audio ??= new Audio();
      if (audio.state === 'suspended') await audio.resume();
    } catch (error) {
      onError(`Sound could not start: ${error.message}. Visual results still work.`);
    }
  }

  function play(level = 1) {
    const preferences = getPreferences();
    if (preferences.vibration && support.vibration) {
      const pattern = Array.from({ length: level * 2 - 1 }, (_, index) => index % 2 ? 65 : 20);
      try {
        if (!navigator.vibrate(pattern)) onError('Vibration was blocked by this browser. Colors and text still work.');
      } catch (error) { onError(`Vibration is unavailable: ${error.message}. Colors and text still work.`); }
    }
    if (!preferences.sound || !support.sound) return;
    if (!audio || audio.state !== 'running') {
      onError('Sound is paused by the browser. Tap Sound off and on to enable it.');
      return;
    }
    try {
      for (let index = 0; index < level; index++) {
        const start = audio.currentTime + index * .13;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(720, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.035, start + .01);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .09);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        active.add(oscillator);
        oscillator.onended = () => { active.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start);
        oscillator.stop(start + .1);
      }
    } catch (error) {
      onError(`Sound could not play: ${error.message}. Visual results still work.`);
    }
  }

  return { support, unlock, play, stop };
}
