// PNG files are bundled by wrangler as binary data ([[rules]] type "Data" in wrangler.toml).
declare module '*.png' {
  const data: ArrayBuffer;
  export default data;
}
