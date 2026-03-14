import { IsString, IsNotEmpty, IsEnum, IsNumber } from 'class-validator';
import { GameType } from 'src/models/enums/game-type.enum';

export class CreateGameResultDto {
  @IsEnum(GameType)
  @IsNotEmpty()
  gameType: GameType;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsNotEmpty()
  result: number;
}
