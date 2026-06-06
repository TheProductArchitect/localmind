import { describe, it, expect } from 'vitest';
import { cn } from '../src/lib/utils'; // Assuming this uses clsx and tailwind-merge

describe('utils', () => {
  describe('cn', () => {
    it('merges class names correctly', () => {
      expect(cn('px-2 py-1', 'bg-blue-500')).toBe('px-2 py-1 bg-blue-500');
    });

    it('handles conditional classes', () => {
      const isTrue = true;
      const isFalse = false;
      expect(cn('base-class', isTrue && 'truthy-class', isFalse && 'falsy-class')).toBe('base-class truthy-class');
    });
    
    it('properly merges tailwind conflicting classes', () => {
      // tailwind-merge should resolve this to py-4
      expect(cn('py-2 p-2', 'py-4')).toBe('p-2 py-4');
    });
  });
});
