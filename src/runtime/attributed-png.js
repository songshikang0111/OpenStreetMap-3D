/** Copy the current WebGL frame synchronously, before the browser clears its drawing buffer. */
export function attributedPNG(source, width, height, credit) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const drawing = canvas.getContext('2d');
  drawing.drawImage(source, 0, 0);
  const font = Math.max(11, Math.round(width / 130));
  drawing.font = `${font}px sans-serif`;
  const text = drawing.measureText(credit).width;
  drawing.fillStyle = 'rgba(255,255,255,.95)';
  drawing.fillRect(0, height - font - 18, width, font + 18);
  drawing.fillStyle = '#28352f';
  drawing.fillText(credit, Math.max(7, width - text - 10), height - 9, width - 14);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(
              Object.assign(new Error('Browser could not encode PNG.'), {
                code: 'PNG_ENCODING_FAILED',
                stage: 'export',
              }),
            ),
      'image/png',
    ),
  );
}
