// Chaque étape expliquée simplement : ce qu'elle fait, ses cas possibles, pourquoi elle existe, et
// ce qui se passe si elle tombe en panne. Affiché dans la bulle d'une étape.

export interface StepGuide {
  does: string
  cases?: { when: string; then?: string }[]
  why: string
  /** « closed » : on répond prudemment ; « open » : on continue avec moins. */
  fail?: { kind: 'closed' | 'open'; text: string }
}

export const GUIDE: Record<string, StepGuide> = {
  redact: {
    does: 'Remplace e-mail, téléphone, IBAN, n° de sécurité sociale et code postal par un marqueur, avant tout appel à l’IA.',
    cases: [{ when: 'Rien à masquer' }, { when: '« Rappelez-moi au 06… »', then: 'le numéro est remplacé' }],
    why: 'Aucune donnée personnelle n’arrive chez le fournisseur d’IA ni dans les traces.',
  },
  circuit_breaker: {
    does: 'Classe le message. Des règles tranchent d’abord (« oublie tes consignes », « quelle dose », insultes, politesse) ; l’IA seulement si besoin.',
    cases: [
      { when: 'Question à traiter', then: 'Chercher' },
      { when: 'Diagnostic ou médicament', then: 'Refus + vétérinaire' },
      { when: 'Détournement, insulte, hors sujet', then: 'Refus poli' },
    ],
    why: 'Une demande interdite n’atteint jamais l’IA qui rédige.',
    fail: { kind: 'closed', text: 'réponse prudente, rien n’est rédigé' },
  },
  query_understanding: {
    does: 'En même temps que le tri : reformule la question pour la recherche, et lit le profil, le collier et les alertes du chien.',
    cases: [
      { when: '3/3 données lues', then: 'la réponse peut citer le collier' },
      { when: 'Une donnée manque', then: 'on continue sans elle (jaune)' },
      { when: '« Merci »', then: 'rien à chercher' },
    ],
    why: 'Répondre sur ce chien-là, avec ses propres chiffres.',
    fail: { kind: 'open', text: 'on continue, on cherche quand même' },
  },
  gate: {
    does: 'Attend le tri et le contexte, puis oriente. La première condition vraie gagne :',
    cases: [
      { when: 'Signal d’urgence', then: 'texte d’urgence, quel que soit le tri' },
      { when: 'Tri en panne', then: 'Réponse prudente' },
      { when: 'Diagnostic demandé', then: 'Refus + vétérinaire' },
      { when: 'Insulte, détournement, hors sujet', then: 'Refus poli' },
      { when: 'Question santé', then: 'Chercher' },
      { when: 'Politesse', then: 'Rédiger directement' },
    ],
    why: 'Une seule étape décide du chemin, avec des règles lisibles et testées.',
  },
  retrieval: {
    does: 'Trouve 20 passages dans les 12 fiches santé, par les mots et par le sens.',
    cases: [{ when: 'Passages trouvés', then: 'ils servent de sources' }, { when: 'Rien de pertinent', then: 'seuls le collier et le message peuvent être cités' }],
    why: 'L’IA n’écrit qu’à partir de sources relues, jamais de mémoire.',
    fail: { kind: 'open', text: 'on continue sans fiche santé' },
  },
  relevance_filter: {
    does: 'Garde au plus 5 passages, ceux qui dépassent un seuil de pertinence.',
    why: 'Moins de texte pour l’IA : moins d’erreurs, plus rapide, moins cher.',
    fail: { kind: 'open', text: 'on garde l’ordre de la recherche' },
  },
  generation: {
    does: 'Écrit la réponse. Chaque phrase cite sa source : une fiche, le collier ou ce qu’a dit le propriétaire.',
    cases: [
      { when: '1er passage', then: 'consigne normale' },
      { when: '2e passage, après un rejet', then: 'consigne durcie' },
      { when: 'Politesse', then: 'une courte phrase' },
    ],
    why: 'La seule étape où l’IA écrit ce que lira le propriétaire.',
    fail: { kind: 'closed', text: 'réponse prudente' },
  },
  guardrail: {
    does: 'Contrôle chaque phrase : une source qui dit bien ça, aucun diagnostic. Ajoute un vétérinaire si une alerte du collier est active ou si l’activité baisse de 30 % sur 5 jours.',
    cases: [
      { when: 'Tout est bon', then: 'Envoyer' },
      { when: 'Rejet au 1er passage', then: 'Rédiger, 2e essai' },
      { when: 'Rejet au 2e passage', then: 'Réponse prudente' },
    ],
    why: 'La garantie : rien de non sourcé ou de diagnostique n’arrive au propriétaire.',
    fail: { kind: 'closed', text: 'réponse prudente' },
  },
  safe_response: {
    does: 'Texte fixe : « Je suis l’assistant Pawrise… je ne change pas de rôle. »',
    cases: [{ when: 'Insulte, détournement, hors sujet' }],
    why: 'Pas de problème de santé, donc pas de vétérinaire.',
  },
  safe_response_escalate: {
    does: 'Texte fixe avec proposition de vétérinaire.',
    cases: [
      { when: 'Diagnostic ou médicament demandé', then: 'refus et consultation' },
      { when: 'Urgence', then: '« Contactez un vétérinaire dès maintenant », en rouge' },
    ],
    why: 'Seul un vétérinaire diagnostique ou prescrit. En urgence, une consigne relue et immédiate.',
  },
  safe_fallback: {
    does: 'Texte fixe : « Je préfère ne pas vous répondre de façon approximative… », avec un vétérinaire.',
    cases: [{ when: 'Une étape de sécurité en panne' }, { when: 'Deux brouillons rejetés' }],
    why: 'Mieux vaut ne rien affirmer que risquer une erreur médicale.',
  },
  finalize: {
    does: 'La seule sortie : joint les sources et le bouton vétérinaire, enregistre le tour dans le journal d’audit (côté serveur).',
    cases: [{ when: 'Signal d’urgence dans le message', then: '« Contactez un vétérinaire dès maintenant » en tête' }],
    why: 'Rien ne part sans être tracé.',
  },
  collect: {
    does: 'Lit le profil, 7 jours de collier et les alertes du chien.',
    why: 'Le vétérinaire reçoit les faits, pas une impression.',
  },
  timeline: {
    does: 'Range les événements par date, sans IA.',
    why: 'Une chronologie claire pour la consultation.',
  },
  synthesize: {
    does: 'Rédige le motif, ce qu’a dit le propriétaire et le niveau d’urgence.',
    why: 'Un dossier lisible en 30 secondes.',
  },
  verify: {
    does: 'Chaque élément doit avoir une source ; aucun langage diagnostique.',
    why: 'Le dossier ne pose pas de diagnostic à la place du vétérinaire.',
  },
}
