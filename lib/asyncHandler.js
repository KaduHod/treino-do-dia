/**
 * O Express 4 não captura rejeições de handlers async, então envolvemos as
 * rotas para encaminhar erros ao middleware de erro.
 */
export function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
