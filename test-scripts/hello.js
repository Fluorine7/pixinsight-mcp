#engine v8
#include <pjsr/DataType.jsh>
if (Parameters.getString('text') !== 'hello, 世界') throw new Error('Parameter mismatch');
console.writeln('MCP script smoke OK');
