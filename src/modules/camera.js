export class CameraModule {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
  }

  async start(constraints = { video: { width: 1280, height: 720, facingMode: 'environment' } }) {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      return new Promise((resolve, reject) => {
        this.video.onloadedmetadata = () => {
          this.video.play().then(() => resolve(this.video)).catch(reject);
        };
        this.video.onerror = reject;
      });
    } catch (err) {
      throw new Error(`No se pudo acceder a la cámara: ${err.message}`);
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  get width() { return this.video.videoWidth; }
  get height() { return this.video.videoHeight; }
}
