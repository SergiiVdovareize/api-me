import {
  IsArray,
  IsString,
  IsNotEmpty,
  ArrayMinSize,
  IsEmail,
  IsOptional,
  Matches,
} from 'class-validator';

export class CreateBoardDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  partners: string[];

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be a 4-digit number' })
  pin?: string;
}
