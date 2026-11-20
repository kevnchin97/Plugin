import { ensureFixtures, FRAMES_2997_FIXTURE, FRAMES_FIXTURE, SCENES_FIXTURE, WEBM_FIXTURE } from "../src/fixtures";

export default async function setup() {
  await ensureFixtures({ only: [SCENES_FIXTURE.file, FRAMES_FIXTURE.file, FRAMES_2997_FIXTURE.file, WEBM_FIXTURE.file] });
}
