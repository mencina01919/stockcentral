import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../../prisma/prisma.service'
import { LoginDto, RegisterDto } from './dto/auth.dto'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, status: 'active' },
      include: { tenant: true },
    })

    if (!user) throw new UnauthorizedException('Credenciales inválidas')

    const valid = await bcrypt.compare(dto.password, user.password)
    if (!valid) throw new UnauthorizedException('Credenciales inválidas')

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    })

    return this.generateTokens(user)
  }

  async register(dto: RegisterDto) {
    const slug = dto.tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50)

    const existingTenant = await this.prisma.tenant.findUnique({ where: { slug } })
    if (existingTenant) throw new ConflictException('El nombre de empresa ya está en uso')

    const hashedPassword = await bcrypt.hash(dto.password, 10)

    const trialEndsAt = new Date()
    trialEndsAt.setDate(trialEndsAt.getDate() + 14)

    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.tenantName,
        slug,
        email: dto.email,
        country: dto.country || 'CL',
        currency: dto.currency || 'CLP',
        plan: 'free',
        status: 'trial',
        trialEndsAt,
      },
    })

    await this.prisma.warehouse.createMany({
      data: [
        { tenantId: tenant.id, name: 'Stock Online', type: 'physical', warehouseType: 'online', isDefault: true, active: true },
        { tenantId: tenant.id, name: 'Bodega Principal', type: 'physical', warehouseType: 'warehouse', isDefault: true, active: true },
        { tenantId: tenant.id, name: 'Tienda', type: 'physical', warehouseType: 'store', isDefault: true, active: true },
      ],
    })

    const user = await this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: 'owner',
        emailVerified: false,
        status: 'active',
      },
      include: { tenant: true },
    })

    return this.generateTokens(user)
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
      })
      const user = await this.prisma.user.findFirst({
        where: { id: payload.sub, status: 'active' },
        include: { tenant: true },
      })
      if (!user) throw new UnauthorizedException()
      return this.generateTokens(user)
    } catch {
      throw new UnauthorizedException('Refresh token inválido')
    }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        emailVerified: true,
        lastLogin: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            status: true,
            currency: true,
            country: true,
          },
        },
      },
    })
    if (!user) throw new NotFoundException('Usuario no encontrado')
    return user
  }

  private generateTokens(user: { id: string; tenantId: string; email: string; role: string }) {
    const payload = { sub: user.id, email: user.email, tenantId: user.tenantId, role: user.role }

    const accessToken = this.jwt.sign(payload, {
      expiresIn: this.config.get('JWT_EXPIRES_IN', '15m'),
    })
    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'),
    })

    return { accessToken, refreshToken, tokenType: 'Bearer' }
  }
}
