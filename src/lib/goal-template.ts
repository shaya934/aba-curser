import type { GoalTemplate } from './goal-bank';
export function draftFromTemplate(e: GoalTemplate, clientId: string, startDate: string) {
  return {
    clientId,
    name: `${e.skill} · ${e.level}`,
    domain: e.domain,
    startDate,
    status: 'Not Started',
    masteryCriteria: e.masteryCriteria,
    description: `${e.goal}\n\nSource: ${e.id} · ${e.level}\nMeasurement guidance: ${e.measurement}\nPrompt expectation: ${e.promptExpectation}\nClinical notes: ${e.clinicalNotes}`,
  };
}
