"use strict";

/**
 * PII Masking Service
 * Detects and masks Personally Identifiable Information in text
 * Supports Singapore-specific patterns and common PII types
 */
class PiiMaskingService {
  constructor() {
    // Singapore NRIC/FIN patterns
    this.nricPattern = /\b[STFG]\d{7}[A-Z]\b/gi;
    
    // Phone number patterns (Singapore)
    this.phonePatterns = [
      /(\+65\s?)?[689]\d{7}/g, // Singapore mobile/landline
      /(\+65\s?)?\d{4}\s?\d{4}/g, // 8-digit with optional spacing
    ];
    
    // Email pattern
    this.emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    
    // Date patterns (various formats)
    this.datePatterns = [
      /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g, // DD/MM/YYYY, DD-MM-YYYY
      /\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b/g, // YYYY/MM/DD
      /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}\b/gi, // DD Month YYYY
    ];
    
    // Address patterns (Singapore postal codes)
    this.addressPatterns = [
      /\bS\d{6}\b/g, // Singapore postal code
      /\b\d{6}\b/g, // 6-digit postal code
      /\b\d{1,4}\s+[A-Za-z\s]+(?:Road|Street|Avenue|Drive|Lane|Close|Crescent|Walk|Park|Gardens?|Estate|Heights?|View|Place|Square|Terrace|Hill|Rise|Grove|Circuit|Link|Way)\b/gi,
    ];
    
    // Medical record number patterns
    this.medicalIdPatterns = [
      /\b(?:MRN|Medical Record|Patient ID|Chart)\s*:?\s*[A-Z0-9\-]{6,15}\b/gi,
      /\b[A-Z]{2,3}\d{6,10}\b/g, // Hospital ID patterns
    ];
    
    // Financial patterns
    this.financialPatterns = [
      /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, // Credit card
      /\b\d{3}[\s\-]?\d{6}[\s\-]?\d{1}\b/g, // Bank account (Singapore DBS format)
    ];
    
    // Name patterns (common titles + names)
    this.namePatterns = [
      /\b(?:Mr|Mrs|Ms|Miss|Dr|Doctor|Prof|Professor)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
      /\b[A-Z][a-z]+\s+(?:bin|binte|d\/o|s\/o)\s+[A-Z][a-z]+\b/g, // Malay naming convention
    ];
  }

  /**
   * Mask PII in text with comprehensive detection
   * @param {string} text - Input text to mask
   * @param {Object} options - Masking options
   * @returns {Object} - {maskedText, metadata}
   */
  maskPii(text, options = {}) {
    if (!text || typeof text !== 'string') {
      return { maskedText: text, metadata: { entities: [], maskingApplied: false } };
    }

    const {
      maskNames = true,
      maskNric = true,
      maskPhone = true,
      maskEmail = true,
      maskDates = true,
      maskAddresses = true,
      maskMedicalIds = true,
      maskFinancial = true,
      preserveLength = false,
      maskChar = '*'
    } = options;

    let maskedText = text;
    const entities = [];
    let entityCounter = 1;

    // Helper function to create mask
    const createMask = (originalText, type, preserveLength = false) => {
      if (preserveLength) {
        return maskChar.repeat(originalText.length);
      }
      
      const entityId = `[${type.toUpperCase()}_${entityCounter++}]`;
      return entityId;
    };

    // Helper function to record entity
    const recordEntity = (type, original, masked, startIndex, endIndex) => {
      entities.push({
        type,
        original,
        masked,
        startIndex,
        endIndex,
        timestamp: new Date().toISOString()
      });
    };

    // Mask NRIC/FIN
    if (maskNric) {
      maskedText = maskedText.replace(this.nricPattern, (match, offset) => {
        const masked = createMask(match, 'nric', preserveLength);
        recordEntity('nric', match, masked, offset, offset + match.length);
        return masked;
      });
    }

    // Mask phone numbers
    if (maskPhone) {
      this.phonePatterns.forEach(pattern => {
        maskedText = maskedText.replace(pattern, (match, offset) => {
          const masked = createMask(match, 'phone', preserveLength);
          recordEntity('phone', match, masked, offset, offset + match.length);
          return masked;
        });
      });
    }

    // Mask emails
    if (maskEmail) {
      maskedText = maskedText.replace(this.emailPattern, (match, offset) => {
        const masked = createMask(match, 'email', preserveLength);
        recordEntity('email', match, masked, offset, offset + match.length);
        return masked;
      });
    }

    // Mask dates
    if (maskDates) {
      this.datePatterns.forEach(pattern => {
        maskedText = maskedText.replace(pattern, (match, offset) => {
          const masked = createMask(match, 'date', preserveLength);
          recordEntity('date', match, masked, offset, offset + match.length);
          return masked;
        });
      });
    }

    // Mask addresses
    if (maskAddresses) {
      this.addressPatterns.forEach(pattern => {
        maskedText = maskedText.replace(pattern, (match, offset) => {
          const masked = createMask(match, 'address', preserveLength);
          recordEntity('address', match, masked, offset, offset + match.length);
          return masked;
        });
      });
    }

    // Mask medical IDs
    if (maskMedicalIds) {
      this.medicalIdPatterns.forEach(pattern => {
        maskedText = maskedText.replace(pattern, (match, offset) => {
          const masked = createMask(match, 'medical_id', preserveLength);
          recordEntity('medical_id', match, masked, offset, offset + match.length);
          return masked;
        });
      });
    }

    // Mask financial information
    if (maskFinancial) {
      this.financialPatterns.forEach(pattern => {
        maskedText = maskedText.replace(pattern, (match, offset) => {
          const masked = createMask(match, 'financial', preserveLength);
          recordEntity('financial', match, masked, offset, offset + match.length);
          return masked;
        });
      });
    }

    // Mask names (optional, can be sensitive)
    if (maskNames) {
      this.namePatterns.forEach(pattern => {
        maskedText = maskedText.replace(pattern, (match, offset) => {
          const masked = createMask(match, 'name', preserveLength);
          recordEntity('name', match, masked, offset, offset + match.length);
          return masked;
        });
      });
    }

    const metadata = {
      entities,
      maskingApplied: entities.length > 0,
      totalEntitiesMasked: entities.length,
      entitiesByType: this.groupEntitiesByType(entities),
      maskingOptions: options,
      processedAt: new Date().toISOString()
    };

    return { maskedText, metadata };
  }

  /**
   * Unmask PII text using metadata
   * @param {string} maskedText - Masked text
   * @param {Object} metadata - Masking metadata
   * @returns {string} - Original text
   */
  unmaskPii(maskedText, metadata) {
    if (!metadata || !metadata.entities || metadata.entities.length === 0) {
      return maskedText;
    }

    let unmaskedText = maskedText;
    
    // Sort entities by start index in descending order to avoid offset issues
    const sortedEntities = [...metadata.entities].sort((a, b) => b.startIndex - a.startIndex);
    
    sortedEntities.forEach(entity => {
      unmaskedText = unmaskedText.replace(entity.masked, entity.original);
    });

    return unmaskedText;
  }

  /**
   * Detect PII without masking
   * @param {string} text - Input text
   * @returns {Object} - Detection results
   */
  detectPii(text) {
    const result = this.maskPii(text, { preserveLength: true });
    return {
      hasPii: result.metadata.maskingApplied,
      entities: result.metadata.entities,
      entitiesByType: result.metadata.entitiesByType,
      totalEntities: result.metadata.totalEntitiesMasked
    };
  }

  /**
   * Group entities by type for reporting
   * @param {Array} entities - Array of detected entities
   * @returns {Object} - Grouped entities
   */
  groupEntitiesByType(entities) {
    return entities.reduce((acc, entity) => {
      if (!acc[entity.type]) {
        acc[entity.type] = [];
      }
      acc[entity.type].push(entity);
      return acc;
    }, {});
  }

  /**
   * Validate masking configuration
   * @param {Object} options - Masking options
   * @returns {Object} - Validation result
   */
  validateMaskingOptions(options) {
    const validOptions = [
      'maskNames', 'maskNric', 'maskPhone', 'maskEmail', 
      'maskDates', 'maskAddresses', 'maskMedicalIds', 
      'maskFinancial', 'preserveLength', 'maskChar'
    ];

    const errors = [];
    const warnings = [];

    Object.keys(options).forEach(key => {
      if (!validOptions.includes(key)) {
        warnings.push(`Unknown option: ${key}`);
      }
    });

    if (options.maskChar && options.maskChar.length !== 1) {
      errors.push('maskChar must be a single character');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get masking statistics
   * @param {Object} metadata - Masking metadata
   * @returns {Object} - Statistics
   */
  getMaskingStats(metadata) {
    if (!metadata || !metadata.entities) {
      return { totalEntities: 0, entitiesByType: {} };
    }

    const stats = {
      totalEntities: metadata.totalEntitiesMasked,
      entitiesByType: {},
      processingTime: metadata.processedAt,
      maskingApplied: metadata.maskingApplied
    };

    Object.keys(metadata.entitiesByType).forEach(type => {
      stats.entitiesByType[type] = metadata.entitiesByType[type].length;
    });

    return stats;
  }
}

module.exports = PiiMaskingService;