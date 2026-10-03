import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class RecoverBoardDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;
}
