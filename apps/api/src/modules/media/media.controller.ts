import {
  Controller,
  Post,
  Get,
  Param,
  UploadedFile,
  UseInterceptors,
  Res,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger'
import { Response } from 'express'
import { memoryStorage } from 'multer'
import { MediaService } from './media.service'
import { Public } from '../../common/decorators/public.decorator'

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(private mediaService: MediaService) {}

  // Public — no auth — so marketplaces (Falabella/MELI/etc.) can fetch
  // images directly from the URL we publish.
  @Public()
  @Get(':filename')
  @ApiOperation({ summary: 'Servir imagen pública (nuevo formato hash)' })
  serveImage(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = this.mediaService.getImagePath(filename)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.sendFile(filePath)
  }

  // Legacy — resolves URLs persisted with the previous tenant/product layout.
  @Public()
  @Get(':tenantId/:productId/:filename')
  @ApiOperation({ summary: 'Servir imagen pública (formato legacy)' })
  serveLegacyImage(
    @Param('tenantId') tenantId: string,
    @Param('productId') productId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const filePath = this.mediaService.getLegacyImagePath(tenantId, productId, filename)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.sendFile(filePath)
  }

  @ApiBearerAuth()
  @Post('upload')
  @ApiOperation({
    summary: 'Subir imagen y obtener URL pública',
    description:
      'Recibe un archivo (JPEG/PNG/WebP, máx 10MB), lo normaliza a JPEG 1600px, lo guarda con nombre = sha256(contenido).jpg, y devuelve la URL pública. El upload es idempotente: subir el mismo archivo dos veces devuelve la misma URL.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    return this.mediaService.uploadProductImage(file)
  }
}
