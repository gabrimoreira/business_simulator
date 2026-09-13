/// <reference types="vite/client" />

/**
 * Carimbo do build, injetado por `vite.config.ts`.
 *
 * Formato: `<sha curto> · <data ISO>`, ou `dev · <data>` fora do git. Serve para
 * conferir, de dentro do app, se o deploy que está no ar é o commit esperado.
 */
declare const __BUILD__: string
