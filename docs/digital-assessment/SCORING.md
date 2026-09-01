# Scoring v1

## Cuestionario

La versión `v1` contiene 25 afirmaciones positivas: P1–P5 Presencia digital, C1–C5 Captación, M1–M5 Marca y percepción, O1–O5 Operaciones y T1–T5 Tecnología. El texto íntegro y sus recomendaciones viven en `src/lib/assessment/questionnaires/v1.ts`; este archivo explica la metodología y no sustituye esa fuente ejecutable.

Cada dimensión pesa 20%. Escala:

| Respuesta | Significado | Normalizado |
|---:|---|---:|
| 1 | Nada cierto en nuestra empresa | 0 |
| 2 | Poco cierto | 25 |
| 3 | Parcialmente cierto | 50 |
| 4 | Bastante cierto | 75 |
| 5 | Totalmente cierto | 100 |
| N/A | No aplica | excluido |

No hay reverse-scoring. Una dimensión necesita al menos tres respuestas válidas; si no, queda `insufficient_data`. Su score es la media aritmética redondeada de respuestas normalizadas. El global es la media ponderada de dimensiones válidas, renormalizando sus pesos cuando alguna es insuficiente. Si ninguna dimensión es válida, no existe resultado.

Las dimensiones válidas se ordenan de menor a mayor score. La primera es `primary_opportunity` y la segunda `secondary_opportunity`; en empates se conserva el orden del cuestionario.

## Niveles de madurez

| Rango | Clave | Etiqueta |
|---:|---|---|
| 0–39 | `IMPORTANT_DIGITAL_DEBT` | Deuda digital importante |
| 40–59 | `FRAGMENTED_DIGITIZATION` | Digitalización fragmentada |
| 60–79 | `SOLID_DIGITAL_BASE` | Base digital sólida |
| 80–100 | `HIGH_DIGITAL_MATURITY` | Madurez digital alta |

Las recomendaciones no usan IA. Cada dimensión tiene cuatro bandas deterministas (`critical`, `developing`, `solid`, `advanced`) con título, detección, importancia y lista inicial de revisión.

## Commercial Lead Score

Es una métrica interna independiente del índice. La configuración completa está en `lead-scoring.ts`.

- Necesidad, 0–40: hasta 30 por inverso del global y 10 por severidad del área más débil.
- Amplitud, 0–20: proporción de dimensiones válidas por debajo de 60.
- Encaje, 0–20: puntos moderados por tamaño; no descarta extremos.
- Intención, 0–20: 8 por completar, 6 por desbloquear y 6 por pedir revisión.

Prioridades: 0–39 LOW, 40–69 MEDIUM, 70–84 HIGH, 85–100 VERY_HIGH. Los tests cubren normalización, N/A, insuficiencia, overall, niveles, oportunidades y límites comerciales.

## Versionado

Cuando existan datos reales, `v1.ts` es inmutable. Cambiar una pregunta, peso, umbral, normalización o mapping requiere `v2.ts`, actualizar el selector de versión en servidor y conservar la capacidad de interpretar registros v1.
