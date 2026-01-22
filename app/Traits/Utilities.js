'use struct'

const fs = require('fs');
const path = require('path');

// Define the path to the JSON file
const filePath = path.join(__dirname, '..', '..', 'utils', 'PackagingMethods.json');

let o = {};

o.areUnsortedArraysEqual = (...arrs) => // Can check unsorted arrays
  arrs.every((arr, i, [first]) => !i || arr.length === first.length) &&
  arrs
    .map(arr =>
      arr.reduce(
        (map, item) => map.set(item, (map.get(item) || 0) + 1),
        new Map(),
      ),
    )
    .every(
      (map, i, [first]) =>
        !i ||
        [...first, ...map].every(([item]) => first.get(item) === map.get(item)),
    );

o.findPackagingMethods = () => {
  try {
    console.log('File path:', filePath); 

    if (!fs.existsSync(filePath)) {
      console.error('File does not exist:', filePath);
      return { status: 404, message: 'File not found' };
    }
    // Read the file synchronously
    const data = fs.readFileSync(filePath, 'utf8');
    // Parse the JSON data
    const packagingMethods = JSON.parse(data);
    return { status: 200, data: packagingMethods };
  } catch (error) {
    console.error('Error reading the JSON file:', error);
    return { status: 500, message: 'Internal Server Error' };
  }
}

// Example usage in an Express route
o.getPackagingMethods = async () => {
  const result = o.findPackagingMethods();
  return result.data;
}

module.exports = o;