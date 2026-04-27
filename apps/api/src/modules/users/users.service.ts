import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, status: true, lastLogin: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, status: true, emailVerified: true, lastLogin: true, createdAt: true,
      },
    })
    if (!user) throw new NotFoundException('Usuario no encontrado')
    return user
  }
}
