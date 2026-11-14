import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, "dados_search.json");

const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
const rows = Object.values(data)[0];

function generateExerciseSearch(rows) {
  const unique = (values) => [...new Set(values)];

  const exercise = rows[0];

  const groups = unique(rows.map((row) => row.grupo_muscular));
  const portions = unique(rows.map((row) => row.porcao_muscular));
  const articulations = unique(rows.map((row) => row.articulacao));
  const movements = unique(rows.map((row) => row.movimento));

  const full_text = [
    exercise.nome_exercicio,
    ...groups,
    ...portions,
    ...articulations,
    ...movements,
    exercise.description,
  ].join(" ");

  const structures_text = [...groups, ...portions, ...articulations, ...movements].join(
    " ",
  );

  return { full_text, structures_text, id: exercise.id_exercicio };
}

Object.values(Object.groupBy(rows, row => row.id_exercicio)).forEach((item) => {
    const { full_text, structures_text, id } = generateExerciseSearch(item)
    console.log(
        `insert into exercise_search (exercise_id, full_text, structures_text) values (${id}, '${full_text}', '${structures_text}');`
    )
})

// console.log(JSON.stringify(generateExerciseSearch(rows), null, 2));
