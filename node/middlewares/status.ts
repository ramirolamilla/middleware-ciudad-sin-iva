export async function status(ctx: Context, next: () => Promise<any>) {
  const code = Number(ctx.vtex.route.params.code)

  ctx.status = code || 200
  ctx.body = {
    message: 'Middleware activo',
    code: code || 200,
  }

  await next()
}