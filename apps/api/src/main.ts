import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
    // Necesario para verificar firmas HMAC sobre el body crudo en
    // /webhooks/in/:provider sin que el JSON parser de Nest mute los bytes.
    rawBody: true,
  })

  app.setGlobalPrefix('api/v1')

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )

  // FRONTEND_URL puede traer una lista coma-separada (ej. Vercel preview +
  // production + localhost). CORS acepta función para validar dinámicamente.
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true) // mobile apps / curl / server-side
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true)
      }
      // Permitir todos los previews de Vercel del proyecto si está definido
      if (process.env.VERCEL_PROJECT_HOST && origin.endsWith(`.${process.env.VERCEL_PROJECT_HOST}`)) {
        return callback(null, true)
      }
      callback(new Error(`CORS: origin ${origin} no permitido`))
    },
    credentials: true,
  })

  const config = new DocumentBuilder()
    .setTitle('StockCentral API')
    .setDescription('Plataforma Omnicanal Multivenda - API Documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document)

  // Railway/Render/Vercel inyectan PORT. Mantenemos API_PORT como fallback
  // local para que `pnpm dev` siga funcionando con el puerto 3001 conocido.
  const port = parseInt(process.env.PORT || process.env.API_PORT || '3001', 10)
  // 0.0.0.0 es obligatorio en entornos contenedorizados — sin esto Railway
  // no puede rutear tráfico al proceso.
  await app.listen(port, '0.0.0.0')
  Logger.log(`API running on port ${port}`, 'Bootstrap')
  Logger.log(`Swagger docs at /api/docs`, 'Bootstrap')
}

bootstrap()
