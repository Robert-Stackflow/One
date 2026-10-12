declare module '*.css?url' {
  const url: string;
  export default url;
}

declare module '*.css?inline' {
  const css: string;
  export default css;
}

declare module '*.wasm?url' {const url:string;export default url;}
declare module '*.html?raw' {const markup:string;export default markup;}
