/**
 * Liga o resolvedor de imports sem extensão. Uso:
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/qualquer-teste.mjs
 *
 * Ver scripts/resolvedor-ts.mjs para o porquê.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./resolvedor-ts.mjs", pathToFileURL(import.meta.filename));
