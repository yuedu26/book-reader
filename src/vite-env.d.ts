/// <reference types="vite/client" />

declare module 'epubjs' {
  const ePub: (input: ArrayBuffer | string | any) => any;
  export default ePub;
}
