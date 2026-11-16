export async function createScanner() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'), import('@zxing/library'),
  ]);
  const hints = new Map([
    [DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A,
      BarcodeFormat.CODE_128, BarcodeFormat.DATA_MATRIX,
    ]],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 250 });
}

export function stopVideo(video) {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
}

export function cameraError(error) {
  if (error.name === 'NotAllowedError') return 'Camera permission was denied. Allow access in browser settings, or enter the barcode manually.';
  if (error.name === 'NotFoundError') return 'No camera found. Manual label entry still works.';
  if (error.name === 'NotReadableError') return 'The camera is busy. Close other camera apps and try again.';
  return `Camera could not start: ${error.message || 'unknown error'}. Manual entry is available.`;
}
