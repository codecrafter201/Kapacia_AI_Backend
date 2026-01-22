const PiiMaskingService = require('../app/Services/PiiMaskingService');

// Test PII masking functionality
const testPiiMasking = () => {
  console.log('Testing PII Masking Service...\n');
  
  const piiMaskingService = new PiiMaskingService();
  
  // Test text with various PII types
  const testText = `
    Patient John Doe (NRIC: S1234567A) called from +65 9123 4567.
    His email is john.doe@example.com and he lives at 123 Orchard Road, S238901.
    Date of birth: 15/03/1985. Medical record number: MRN123456789.
    Credit card: 4532 1234 5678 9012.
  `;
  
  console.log('Original text:');
  console.log(testText);
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test masking
  const result = piiMaskingService.maskPii(testText, {
    maskNames: true,
    maskNric: true,
    maskPhone: true,
    maskEmail: true,
    maskDates: true,
    maskAddresses: true,
    maskMedicalIds: true,
    maskFinancial: true,
    preserveLength: false
  });
  
  console.log('Masked text:');
  console.log(result.maskedText);
  console.log('\n' + '='.repeat(50) + '\n');
  
  console.log('PII Detection Results:');
  console.log('- Masking Applied:', result.metadata.maskingApplied);
  console.log('- Total Entities Masked:', result.metadata.totalEntitiesMasked);
  console.log('- Entities by Type:', result.metadata.entitiesByType);
  console.log('\n');
  
  // Test unmasking
  const unmaskedText = piiMaskingService.unmaskPii(result.maskedText, result.metadata);
  console.log('Unmasked text matches original:', unmaskedText.trim() === testText.trim());
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test detection only
  const detection = piiMaskingService.detectPii(testText);
  console.log('PII Detection (without masking):');
  console.log('- Has PII:', detection.hasPii);
  console.log('- Total Entities:', detection.totalEntities);
  console.log('- Entity Types:', Object.keys(detection.entitiesByType));
  
  console.log('\nTest completed successfully! ✅');
};

// Run the test
if (require.main === module) {
  testPiiMasking();
}

module.exports = { testPiiMasking };