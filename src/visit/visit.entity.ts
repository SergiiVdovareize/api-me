import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('visit')
export class Visit {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column({ name: 'apiType', type: 'tinyint', nullable: true })
    apiType: number;

    @Column({ name: 'timestamp', type: 'int', nullable: false })
    timestamp: number;
  }