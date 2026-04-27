import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class LoginDto {
  @ApiProperty({ example: 'admin@demo-store.com' })
  @IsEmail()
  email: string

  @ApiProperty({ example: 'Admin1234!' })
  @IsString()
  @MinLength(6)
  password: string
}

export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email: string

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string

  @ApiProperty()
  @IsString()
  firstName: string

  @ApiProperty()
  @IsString()
  lastName: string

  @ApiProperty()
  @IsString()
  tenantName: string

  @ApiProperty({ required: false, default: 'CL' })
  @IsOptional()
  @IsString()
  country?: string

  @ApiProperty({ required: false, default: 'CLP' })
  @IsOptional()
  @IsString()
  currency?: string
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string
}
