export {};

declare global {
  namespace PrismaJson {
    // Define your field as an array of strings
    type StringArray = string[];
  }
}
