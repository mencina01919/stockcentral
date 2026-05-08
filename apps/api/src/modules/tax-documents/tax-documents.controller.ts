import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  Res,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger'
import { memoryStorage } from 'multer'
import { Response } from 'express'
import { TaxDocumentsService } from './tax-documents.service'
import {
  TaxDocumentQueryDto,
  EmitTaxDocumentDto,
  CreditNoteDto,
  UploadManualDocumentDto,
  EmitBulkDto,
  MarkExternalDto,
} from './dto/tax-document.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { Public } from '../../common/decorators/public.decorator'

@ApiTags('Tax Documents')
@Controller('tax-documents')
export class TaxDocumentsController {
  constructor(private service: TaxDocumentsService) {}

  // PDFs subidos manualmente: ruta pública para que el navegador los renderice
  // sin token. URL persistida en TaxDocument.pdfUrl.
  @Public()
  @Get('files/:filename')
  @ApiOperation({ summary: 'Servir un PDF subido manualmente (público)' })
  serveFile(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = this.service.getUploadedPdfPath(filename)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.sendFile(filePath)
  }

  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'Listar documentos tributarios emitidos' })
  findAll(@TenantId() tenantId: string, @Query() query: TaxDocumentQueryDto) {
    return this.service.findAll(tenantId, query)
  }

  @ApiBearerAuth()
  @Get('export.csv')
  @ApiOperation({ summary: 'Exportar TaxDocuments como CSV (sin paginación)' })
  async exportCsv(
    @TenantId() tenantId: string,
    @Query() query: TaxDocumentQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.service.exportCsv(tenantId, query)
    const filename = `tax-documents-${new Date().toISOString().slice(0, 10)}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    // BOM para que Excel detecte UTF-8 correctamente.
    res.send('﻿' + csv)
  }

  @ApiBearerAuth()
  @Post('test-connection/:provider')
  @ApiOperation({ summary: 'Probar la conexión con el facturador (bsale, etc.)' })
  testConnection(@TenantId() tenantId: string, @Param('provider') provider: string) {
    return this.service.testEmitterConnection(tenantId, provider)
  }

  @ApiBearerAuth()
  @Post('upload-manual')
  @ApiOperation({ summary: 'Registrar manualmente un documento ya emitido (PDF)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        saleId: { type: 'string' },
        type: { type: 'string', enum: ['boleta', 'factura', 'nota_credito'] },
        folio: { type: 'string' },
        emittedAt: { type: 'string' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadManual(
    @TenantId() tenantId: string,
    @Body() dto: UploadManualDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadManualDocument(tenantId, dto, file)
  }

  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un documento' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id)
  }

  @ApiBearerAuth()
  @Post('emit/sale/:saleId')
  @ApiOperation({ summary: 'Emitir boleta o factura para una venta (manual)' })
  emitForSale(
    @TenantId() tenantId: string,
    @Param('saleId') saleId: string,
    @Body() dto: EmitTaxDocumentDto,
  ) {
    return this.service.emitForSale(tenantId, saleId, dto)
  }

  @ApiBearerAuth()
  @Post('emit-bulk')
  @ApiOperation({ summary: 'Emitir DTE para múltiples ventas (encola con throttle)' })
  emitBulk(@TenantId() tenantId: string, @Body() dto: EmitBulkDto) {
    return this.service.emitBulk(tenantId, dto)
  }

  @ApiBearerAuth()
  @Post('mark-external')
  @ApiOperation({
    summary: 'Marcar ventas como cargadas por otro medio (sin tocar Bsale)',
  })
  markExternal(@TenantId() tenantId: string, @Body() dto: MarkExternalDto) {
    return this.service.markExternal(tenantId, dto)
  }

  @ApiBearerAuth()
  @Post(':id/retry')
  @ApiOperation({ summary: 'Reintentar emisión de un documento fallido' })
  retry(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.retry(tenantId, id)
  }

  @ApiBearerAuth()
  @Post('credit-note/sale/:saleId')
  @ApiOperation({ summary: 'Emitir nota de crédito total para una venta' })
  emitCreditNote(
    @TenantId() tenantId: string,
    @Param('saleId') saleId: string,
    @Body() dto: CreditNoteDto,
  ) {
    return this.service.emitCreditNoteForSale(tenantId, saleId, dto)
  }

  @ApiBearerAuth()
  @Post('convert-to-factura/sale/:saleId')
  @ApiOperation({
    summary: 'Convertir la boleta emitida en factura (NC + factura nueva)',
  })
  convertToFactura(@TenantId() tenantId: string, @Param('saleId') saleId: string) {
    return this.service.convertBoletaToFactura(tenantId, saleId)
  }

  @ApiBearerAuth()
  @Post(':id/push-to-marketplace')
  @ApiOperation({
    summary: 'Forzar push del DTE al marketplace (manual, ignora flag pushToMarketplace)',
  })
  pushToMarketplace(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.pushToMarketplaceManual(tenantId, id)
  }
}
