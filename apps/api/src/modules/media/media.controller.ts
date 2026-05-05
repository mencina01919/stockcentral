import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UploadedFile,
  UseInterceptors,
  Res,
  Query,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger'
import { Response } from 'express'
import { memoryStorage } from 'multer'
import { MediaService } from './media.service'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { Public } from '../../common/decorators/public.decorator'

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(private mediaService: MediaService) {}

  // Endpoint público — sin autenticación — para que los marketplaces puedan
  // acceder directamente a las imágenes por URL.
  @Public()
  @Get(':tenantId/:productId/:filename')
  @ApiOperation({ summary: 'Servir imagen pública' })
  serveImage(
    @Param('tenantId') tenantId: string,
    @Param('productId') productId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const filePath = this.mediaService.getImagePath(tenantId, productId, filename)
    res.sendFile(filePath)
  }

  @ApiBearerAuth()
  @Get('product/:productId')
  @ApiOperation({ summary: 'Listar imágenes de un producto' })
  listImages(@TenantId() tenantId: string, @Param('productId') productId: string) {
    return this.mediaService.listProductImages(tenantId, productId)
  }

  @ApiBearerAuth()
  @Post('product/:productId/upload')
  @ApiOperation({ summary: 'Subir imagen y generar variantes por marketplace' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadImage(
    @TenantId() tenantId: string,
    @Param('productId') productId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.mediaService.uploadProductImage(tenantId, productId, file)
  }

  @ApiBearerAuth()
  @Delete('product/:productId/:filename')
  @ApiOperation({ summary: 'Eliminar imagen y sus variantes' })
  deleteImage(
    @TenantId() tenantId: string,
    @Param('productId') productId: string,
    @Param('filename') filename: string,
  ) {
    return this.mediaService.deleteProductImage(tenantId, productId, filename)
  }
}
