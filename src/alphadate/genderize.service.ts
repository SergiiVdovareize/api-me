import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class GenderizeService {
  private readonly logger = new Logger(GenderizeService.name);

  async detectGenders(names: string[]): Promise<('male' | 'female' | null)[]> {
    if (!names || names.length === 0) {
      return [];
    }

    const firstNames = names.map(n => (n || '').trim().split(/\s+/)[0] || '');

    const validIndices: number[] = [];
    const queryParts: string[] = [];

    firstNames.forEach((name, idx) => {
      if (name) {
        validIndices.push(idx);
        queryParts.push(`name[]=${encodeURIComponent(name)}`);
      }
    });

    const results: ('male' | 'female' | null)[] = new Array(names.length).fill(null);

    if (queryParts.length === 0) {
      return results;
    }

    const url = `https://api.genderize.io?${queryParts.join('&')}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        this.logger.warn(`Genderize.io returned status: ${res.status}`);
        return results;
      }

      const data = await res.json();
      const items = Array.isArray(data) ? data : [data];

      items.forEach((item, index) => {
        const originalIndex = validIndices[index];
        if (originalIndex !== undefined) {
          if (item && (item.gender === 'male' || item.gender === 'female')) {
            results[originalIndex] = item.gender;
          } else {
            results[originalIndex] = null;
          }
        }
      });
    } catch (err: any) {
      this.logger.warn(`Failed to fetch gender from Genderize.io: ${err.message}`);
    }

    return results;
  }

  assignPlayerIds(genders: ('male' | 'female' | null)[]): (number | null)[] {
    let nextMaleId = 1;
    let nextFemaleId = 2;

    return genders.map(gender => {
      if (gender === 'male') {
        const id = nextMaleId;
        nextMaleId += 2;
        return id;
      }
      if (gender === 'female') {
        const id = nextFemaleId;
        nextFemaleId += 2;
        return id;
      }
      return null;
    });
  }
}
