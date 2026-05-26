export class HomographyModule {
  constructor(cv) {
    this.cv          = cv;
    this.H           = null;   // cv.Mat con la matriz de homografía 3x3
    this.rectWidth   = 0;
    this.rectHeight  = 0;
  }

  /**
   * Calcula la homografía a partir de las 4 esquinas seleccionadas en la imagen de cámara.
   * Las esquinas deben estar en orden: ↖ ↗ ↘ ↙
   * @param {Array<{x,y}>} srcCorners - 4 puntos en espacio de cámara
   * @param {number} dstWidth         - Ancho del plano rectificado de destino
   * @param {number} dstHeight        - Alto del plano rectificado de destino
   */
  compute(srcCorners, dstWidth, dstHeight) {
    if (srcCorners.length !== 4) throw new Error('Se requieren exactamente 4 esquinas');

    this.rectWidth  = dstWidth;
    this.rectHeight = dstHeight;

    const cv = this.cv;

    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      srcCorners[0].x, srcCorners[0].y,
      srcCorners[1].x, srcCorners[1].y,
      srcCorners[2].x, srcCorners[2].y,
      srcCorners[3].x, srcCorners[3].y,
    ]);

    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0,        0,
      dstWidth, 0,
      dstWidth, dstHeight,
      0,        dstHeight,
    ]);

    if (this.H) this.H.delete();
    this.H = cv.getPerspectiveTransform(srcPts, dstPts);

    srcPts.delete();
    dstPts.delete();
  }

  /**
   * Transforma un punto del espacio de cámara al espacio rectificado.
   * @param {number} x
   * @param {number} y
   * @returns {{x: number, y: number}}
   */
  transformPoint(x, y) {
    if (!this.H) throw new Error('Homografía no calculada');
    const cv = this.cv;

    const srcPt = cv.matFromArray(1, 1, cv.CV_32FC2, [x, y]);
    const dstPt = new cv.Mat();
    cv.perspectiveTransform(srcPt, dstPt, this.H);

    const result = { x: dstPt.data32F[0], y: dstPt.data32F[1] };
    srcPt.delete();
    dstPt.delete();
    return result;
  }

  /**
   * Aplica la corrección de perspectiva a un frame completo.
   * @param {cv.Mat} srcMat - Frame de entrada (del canvas de cámara)
   * @returns {cv.Mat}      - Frame rectificado (el llamador debe hacer .delete())
   */
  warpFrame(srcMat) {
    if (!this.H) throw new Error('Homografía no calculada');
    const cv  = this.cv;
    const dst = new cv.Mat();
    cv.warpPerspective(
      srcMat, dst, this.H,
      new cv.Size(this.rectWidth, this.rectHeight),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar()
    );
    return dst;
  }

  get isReady() {
    return this.H !== null;
  }

  dispose() {
    if (this.H) { this.H.delete(); this.H = null; }
  }
}
