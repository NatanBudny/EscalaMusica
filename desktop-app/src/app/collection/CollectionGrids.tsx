// Grades acessiveis de coleta de Insumos_Externos e conferencia de PDF
// (Requisitos 4.1-4.8, 4.15, 4.18-4.20; design.md -> etapa de Coleta).
//
// Principios aplicados:
//  - O PDF e APENAS referencia externa: nao ha upload nem parsing. O operador
//    abre o PDF fora do app e DIGITA os dados nas grades (4.18, 4.19).
//  - Toda entrada passa por uma CONFERENCIA (tela-resumo) antes de confirmar o
//    insumo (4.20). Nada e salvo sem o operador confirmar o resumo.
//  - Validacao objetiva: cardinalidades e comprimentos de borda sao verificados
//    pelo dominio; observacao sem classificacao (4.7) e insumo sem proveniencia
//    (4.8) NAO sao salvos; o erro aparece inline.
//  - Sem JSON livre: anciao/pregador/sonoplastia usam selecao de pessoas e
//    departamentos; textos usam campos simples.
//
// A grade le o estado de `useExternalInputs` (que detem o servico de dominio);
// nenhum modelo paralelo e criado.

import { useCallback, useId, useMemo, useState } from 'react';
import { useExternalInputs } from './useExternalInputs';
import { newUuid, nowUtc } from './ids';
import type {
  ConfirmationSummary,
  ExternalInputSnapshot,
  RegisterExternalInput,
} from '../../domain/cycle/externalInputService';
import type { ExternalInputType } from '../../domain/schemas/models';

/** Opcao de sujeito (pessoa ou departamento) para os seletores. */
export interface SubjectOption {
  id: string;
  name: string;
}

/** Culto ao qual os insumos pertencem. */
export interface ServiceOption {
  id: string;
  label: string;
}

export interface CollectionGridsProps {
  /** Cultos do ciclo (o insumo e sempre vinculado a um culto). */
  services: ServiceOption[];
  /** Pessoas ativas selecionaveis (anciao, audiovisual, pregador-pessoa). */
  people: SubjectOption[];
  /** Departamentos selecionaveis (pregador-departamento). */
  departments: SubjectOption[];
  /** Operador responsavel (proveniencia, Requisito 4.8). */
  operatorId: string;
  /** Snapshot inicial opcional. */
  initial?: ExternalInputSnapshot;
}

const TYPE_TABS: Array<{ type: ExternalInputType; label: string }> = [
  { type: 'elder', label: 'Anciao' },
  { type: 'preacher', label: 'Pregador' },
  { type: 'audio', label: 'Sonoplastia' },
  { type: 'sabbath-school-song', label: 'Musicas (ES)' },
  { type: 'theme', label: 'Tema' },
  { type: 'song-request', label: 'Pedidos' },
  { type: 'observation', label: 'Observacoes' },
];

export function CollectionGrids(props: CollectionGridsProps): JSX.Element {
  const { services, people, departments, operatorId, initial } = props;
  const store = useExternalInputs(initial);

  const [activeType, setActiveType] = useState<ExternalInputType>('elder');
  const [serviceId, setServiceId] = useState<string>(services[0]?.id ?? '');
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Resumo pendente de confirmacao (Requisito 4.20).
  const [pending, setPending] = useState<{
    summary: ConfirmationSummary;
    input: RegisterExternalInput;
  } | null>(null);

  // Estado dos campos por tipo.
  const [elderPerson, setElderPerson] = useState('');
  const [preacherType, setPreacherType] = useState<'person' | 'department'>('person');
  const [preacherId, setPreacherId] = useState('');
  const [audioIds, setAudioIds] = useState<string[]>([]);
  const [textValue, setTextValue] = useState('');
  const [obsClass, setObsClass] = useState<'public' | 'private' | ''>('');

  const serviceInputs = useMemo(
    () => (serviceId ? store.forService(serviceId) : []),
    [store, serviceId],
  );

  const sourceId = useId();
  const serviceSelId = useId();

  const resetFields = useCallback(() => {
    setElderPerson('');
    setPreacherType('person');
    setPreacherId('');
    setAudioIds([]);
    setTextValue('');
    setObsClass('');
  }, []);

  /** Monta o comando de registro a partir dos campos do tipo ativo. */
  const buildInput = useCallback((): RegisterExternalInput => {
    const base = {
      id: newUuid(),
      serviceId,
      provenance: { source, operatorId, updatedAt: nowUtc() },
    };
    switch (activeType) {
      case 'elder':
        return { ...base, type: 'elder', value: { personId: elderPerson } };
      case 'preacher':
        return {
          ...base,
          type: 'preacher',
          value: { subject: { type: preacherType, id: preacherId } },
        };
      case 'audio':
        return { ...base, type: 'audio', value: { personIds: audioIds } };
      case 'sabbath-school-song':
        return { ...base, type: 'sabbath-school-song', value: { title: textValue } };
      case 'theme':
        return { ...base, type: 'theme', value: { text: textValue } };
      case 'song-request':
        return { ...base, type: 'song-request', value: { description: textValue } };
      case 'observation':
        return {
          ...base,
          type: 'observation',
          value: {
            text: textValue,
            // classificacao vazia e intencionalmente invalida para disparar 4.7
            classification: obsClass as 'public' | 'private',
          },
        };
      default:
        return { ...base, type: 'theme', value: { text: textValue } };
    }
  }, [
    activeType,
    serviceId,
    source,
    operatorId,
    elderPerson,
    preacherType,
    preacherId,
    audioIds,
    textValue,
    obsClass,
  ]);

  // Etapa 1: conferir (valida sem salvar -> mostra resumo) (4.20).
  const handleConferir = useCallback(() => {
    setError(null);
    setStatus(null);
    const input = buildInput();
    const result = store.validate(input);
    if (!result.ok) {
      setError(result.error.message);
      setPending(null);
      return;
    }
    setPending({ summary: result.value, input });
  }, [buildInput, store]);

  // Etapa 2: confirmar (salva o insumo ja conferido).
  const handleConfirmar = useCallback(() => {
    if (!pending) return;
    const result = store.register(pending.input);
    if (!result.ok) {
      setError(result.error.message);
      setPending(null);
      return;
    }
    setPending(null);
    setStatus('Insumo confirmado e salvo.');
    resetFields();
  }, [pending, store, resetFields]);

  const handleCancelarConferencia = useCallback(() => {
    setPending(null);
  }, []);

  const toggleAudio = useCallback((id: string) => {
    setAudioIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }, []);

  const subjectName = useCallback(
    (id: string): string => {
      const all = [...people, ...departments];
      return all.find((s) => s.id === id)?.name ?? id;
    },
    [people, departments],
  );

  return (
    <section aria-label="Coleta de insumos externos">
      <h1>Coleta de insumos externos</h1>

      <p>
        O PDF de anciaos, pregadores e sonoplastia e apenas referencia: abra-o
        separadamente e digite os dados abaixo. Toda entrada e conferida antes de
        salvar.
      </p>

      <div role="status" aria-live="polite">
        {status ?? ''}
      </div>

      <label htmlFor={serviceSelId}>Culto</label>
      <select
        id={serviceSelId}
        value={serviceId}
        onChange={(e) => {
          setServiceId(e.target.value);
          setPending(null);
        }}
      >
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      <label htmlFor={sourceId}>Fonte (proveniencia)</label>
      <input
        id={sourceId}
        type="text"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="ex.: PDF anciaos 2026-02"
      />

      <div role="tablist" aria-label="Tipos de insumo">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.type}
            type="button"
            role="tab"
            aria-selected={activeType === tab.type}
            onClick={() => {
              setActiveType(tab.type);
              setPending(null);
              setError(null);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={`Entrada de ${activeType}`}>
        {activeType === 'elder' && (
          <>
            <label htmlFor="elder-person">Anciao responsavel</label>
            <select
              id="elder-person"
              value={elderPerson}
              onChange={(e) => setElderPerson(e.target.value)}
            >
              <option value="">Selecione uma pessoa</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        )}

        {activeType === 'preacher' && (
          <>
            <fieldset>
              <legend>Tipo de pregador</legend>
              <label>
                <input
                  type="radio"
                  name="preacher-type"
                  checked={preacherType === 'person'}
                  onChange={() => {
                    setPreacherType('person');
                    setPreacherId('');
                  }}
                />
                Pessoa
              </label>
              <label>
                <input
                  type="radio"
                  name="preacher-type"
                  checked={preacherType === 'department'}
                  onChange={() => {
                    setPreacherType('department');
                    setPreacherId('');
                  }}
                />
                Departamento
              </label>
            </fieldset>
            <label htmlFor="preacher-subject">Pregador responsavel</label>
            <select
              id="preacher-subject"
              value={preacherId}
              onChange={(e) => setPreacherId(e.target.value)}
            >
              <option value="">Selecione</option>
              {(preacherType === 'person' ? people : departments).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </>
        )}

        {activeType === 'audio' && (
          <fieldset>
            <legend>Audiovisual / Sonoplastia (de 1 a 20 pessoas)</legend>
            {people.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={audioIds.includes(p.id)}
                  onChange={() => toggleAudio(p.id)}
                />
                {p.name}
              </label>
            ))}
          </fieldset>
        )}

        {activeType === 'sabbath-school-song' && (
          <>
            <label htmlFor="song-title">Titulo da musica (Escola Sabatina)</label>
            <input
              id="song-title"
              type="text"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              maxLength={200}
            />
          </>
        )}

        {activeType === 'theme' && (
          <>
            <label htmlFor="theme-text">Tema do culto</label>
            <input
              id="theme-text"
              type="text"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              maxLength={200}
            />
          </>
        )}

        {activeType === 'song-request' && (
          <>
            <label htmlFor="request-text">Pedido de musica do pregador</label>
            <input
              id="request-text"
              type="text"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              maxLength={200}
            />
          </>
        )}

        {activeType === 'observation' && (
          <>
            <label htmlFor="obs-text">Observacao</label>
            <textarea
              id="obs-text"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
            />
            <fieldset>
              <legend>Classificacao (obrigatoria antes de salvar)</legend>
              <label>
                <input
                  type="radio"
                  name="obs-class"
                  checked={obsClass === 'public'}
                  onChange={() => setObsClass('public')}
                />
                Publica
              </label>
              <label>
                <input
                  type="radio"
                  name="obs-class"
                  checked={obsClass === 'private'}
                  onChange={() => setObsClass('private')}
                />
                Privada
              </label>
            </fieldset>
          </>
        )}
      </div>

      {error ? (
        <p role="alert">{error}</p>
      ) : null}

      {pending ? (
        <div role="dialog" aria-label="Conferencia do insumo">
          <h2>Conferencia</h2>
          <p>Confira os dados digitados antes de confirmar.</p>
          <dl>
            <dt>Tipo</dt>
            <dd>{pending.summary.typeLabel}</dd>
            <dt>Fonte</dt>
            <dd>{pending.summary.source}</dd>
          </dl>
          <ul>
            {pending.summary.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <button type="button" onClick={handleConfirmar}>
            Confirmar insumo
          </button>
          <button type="button" onClick={handleCancelarConferencia}>
            Voltar e corrigir
          </button>
        </div>
      ) : (
        <button type="button" onClick={handleConferir} disabled={serviceId === ''}>
          Conferir antes de salvar
        </button>
      )}

      <h2>Insumos deste culto</h2>
      <div role="grid" aria-label="Insumos do culto" aria-rowcount={serviceInputs.length}>
        <div role="row">
          <span role="columnheader">Tipo</span>
          <span role="columnheader">Resumo</span>
          <span role="columnheader">Fonte</span>
          <span role="columnheader">Visibilidade</span>
          <span role="columnheader">Acoes</span>
        </div>
        {serviceInputs.length === 0 ? (
          <p>Nenhum insumo registrado para este culto.</p>
        ) : (
          serviceInputs.map((input) => (
            <div role="row" key={input.id}>
              <span role="gridcell">{input.type}</span>
              <span role="gridcell">{summarizeValue(input.type, input.value, subjectName)}</span>
              <span role="gridcell">{input.source}</span>
              <span role="gridcell">
                {input.visibility === 'public' ? 'Publico' : 'Privado'}
              </span>
              <span role="gridcell">
                <button
                  type="button"
                  aria-label={`Remover insumo ${input.type}`}
                  onClick={() => store.remove(input.id)}
                >
                  Remover
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/** Resumo legivel do valor de um insumo salvo, para a grade. */
function summarizeValue(
  type: ExternalInputType,
  value: unknown,
  subjectName: (id: string) => string,
): string {
  switch (type) {
    case 'elder':
      return subjectName((value as { personId: string }).personId);
    case 'preacher': {
      const s = (value as { subject: { id: string } }).subject;
      return subjectName(s.id);
    }
    case 'audio':
      return (value as { personIds: string[] }).personIds.map(subjectName).join(', ');
    case 'sabbath-school-song':
      return (value as { title: string }).title;
    case 'theme':
      return (value as { text: string }).text;
    case 'song-request':
      return (value as { description: string }).description;
    case 'observation': {
      const v = value as { text: string; classification: string };
      return `${v.classification === 'public' ? '[publica] ' : '[privada] '}${v.text}`;
    }
    default:
      return '';
  }
}
