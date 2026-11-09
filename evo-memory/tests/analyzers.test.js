const assert = require('assert');
require('../core/analyzers.js');
const E = globalThis.EVO;

// Contrato [EVO]
const txt = 'Listo, ya quedó.\n[EVO]\narchivos_modificados: app.js\nverificado: nada\nsin_verificar: todo\n[/EVO]';
const c = E.parseContract(txt);
assert.strictEqual(c.archivos_modificados, 'app.js');
assert.ok(E.prematureCompletion(txt, c), 'debe marcar cierre prematuro');
assert.ok(E.prematureCompletion('Listo, debería funcionar.', null), 'sin bloque también');
assert.ok(!E.prematureCompletion('Listo.\n[EVO]\nverificado: npm test pasó 12/12\n[/EVO]', E.parseContract('[EVO]\nverificado: npm test pasó 12/12\n[/EVO]')));
assert.ok(!E.prematureCompletion('Te explico cómo funciona el módulo.', null));

// Mismo error con distintos números y rutas => misma huella
const e1 = 'TypeError: Cannot read properties of undefined (reading "id") at /home/a/x.js:10:5';
const e2 = 'TypeError: Cannot read properties of undefined (reading "id") at /srv/b/y.js:77:9';
assert.strictEqual(E.errorFingerprint(e1), E.errorFingerprint(e2));
assert.notStrictEqual(E.errorFingerprint(e1), E.errorFingerprint('ReferenceError: foo is not defined at line 3'));
assert.strictEqual(E.errorFingerprint('Me da ' + e1), E.errorFingerprint('Sigue igual: ' + e2));
assert.strictEqual(E.errorFingerprint('todo bien, gracias'), null);

// Similitud: idéntico = 1; cambio pequeño > 0.5; código distinto < 0.2
const v1 = 'function sumar(a,b){ return a+b }\nfunction restar(a,b){ return a-b }\nfunction multiplicar(a,b){ return a*b }\nfunction dividir(a,b){ if(b===0) throw new Error("div0"); return a/b }';
const v2 = v1.replace('a-b', 'a - b - 0');
assert.strictEqual(E.jaccard(E.shingles(v1), E.shingles(v1)), 1);
assert.ok(E.jaccard(E.shingles(v1), E.shingles(v2)) > 0.5);
assert.ok(E.jaccard(E.shingles(v1), E.shingles('class Otro { constructor(){ this.x = 1 } }')) < 0.2);

// Regresión: la v3 elimina "dividir" y "restar"
const v3 = 'function sumar(a,b){ return a+b }\nfunction multiplicar(a,b){ return a*b }\nfunction dividir2(a,b){ return a/b }';
const gone = E.symbols(v1).filter((x) => !E.symbols(v3).includes(x));
assert.deepStrictEqual(gone.sort(), ['dividir', 'restar']);
assert.ok(E.symbols('def foo():\n  pass\nclass Bar:\n  def baz(self): pass').includes('baz'));
assert.ok(E.symbols('public static int Calcular(int x) { return x; }').includes('Calcular'));

console.log('Todas las pruebas pasaron.');
