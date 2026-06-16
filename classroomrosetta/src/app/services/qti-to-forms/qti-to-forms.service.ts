/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Injectable, inject} from '@angular/core';
import {HttpClient, HttpHeaders, HttpParams} from '@angular/common/http';
import {Observable, catchError, concatMap, forkJoin, from, map, of, reduce, switchMap, throwError} from 'rxjs';
import {decode} from 'html-entities';
import {DriveFile, ImsccFile, Material} from '../../interfaces/classroom-interface';
import {
  BatchUpdateFormRequest,
  BatchUpdateFormResponse,
  FormInfo,
  FormItem,
  FormRequest,
  GoogleForm,
  Image as FormsImage,
  Option,
  Question,
  SetPublishSettingsRequest,
} from '../../interfaces/forms-interface';
import {AuthService} from '../auth/auth.service';
import {FileUploadService} from '../file-upload/file-upload.service';
import {UtilitiesService} from '../utilities/utilities.service';

interface ImageReference {
  source: string;
  altText: string;
  file?: ImsccFile;
}

interface ParsedOption {
  identifier: string;
  value: string;
  image?: ImageReference;
}

interface ParsedFormItem {
  kind: 'question' | 'text' | 'image';
  title: string;
  description?: string;
  question?: Question;
  image?: ImageReference;
  optionImages?: Map<string, ImageReference>;
}

interface HostedImage {
  originalFile: ImsccFile;
  driveFile: DriveFile;
  permissionId: string;
  sourceUri: string;
}

interface ParsedQuiz {
  description: string;
  items: ParsedFormItem[];
  warnings: string[];
}

interface FormConversionStats {
  itemCount: number;
  questionCount: number;
  totalPoints: number;
  dropdownCount: number;
}

interface ParsedQtiCandidate {
  file: ImsccFile;
  parsedQuiz: ParsedQuiz;
  title: string;
  stats: FormConversionStats;
}

@Injectable({
  providedIn: 'root'
})
export class QtiToFormsService {
  private readonly APP_PROPERTY_KEY = 'imsccIdentifier';
  private readonly FORM_CONVERSION_VERSION = 'qti-forms-v6';
  private readonly MAX_REQUESTS_PER_BATCH = 100;

  private http = inject(HttpClient);
  private utils = inject(UtilitiesService);
  private fileUploadService = inject(FileUploadService);
  private auth = inject(AuthService);

  createFormFromQti(
    qtiFile: ImsccFile,
    allPackageFiles: ImsccFile[],
    formTitle: string,
    itemId: string,
    parentFolderId: string
  ): Observable<Material | null> {
    if (!qtiFile?.data || typeof qtiFile.data !== 'string') {
      return throwError(() => new Error('QTI file data is missing or is not text.'));
    }
    if (!itemId || !formTitle || !parentFolderId) {
      return throwError(() => new Error('QTI conversion requires an item ID, title, and parent folder.'));
    }

    let parsedQuiz: ParsedQuiz;
    try {
      const qtiCandidate = this.selectBestQtiCandidate(qtiFile, allPackageFiles, formTitle);
      parsedQuiz = qtiCandidate.parsedQuiz;
      if (qtiCandidate.file.name !== qtiFile.name) {
        console.warn(`[QTI Service] Using richer QTI source for "${formTitle}": ${qtiCandidate.file.name}`, qtiCandidate.stats);
        parsedQuiz.warnings.push(`Used richer matching QTI source: ${qtiCandidate.file.name}`);
      }
    } catch (error) {
      return throwError(() => error);
    }

    return from(this.utils.generateHash(this.getFormCacheKey(itemId))).pipe(
      switchMap(hashedItemId => this.findExistingForm(parentFolderId, hashedItemId).pipe(
        switchMap(existing => {
          if (existing) {
            return of({
              form: {
                formUrl: existing.webViewLink || `https://docs.google.com/forms/d/${existing.id}/viewform`,
                title: existing.name
              }
            } as Material);
          }

          const imageFiles = this.collectUniqueImageFiles(parsedQuiz.items);
          return this.uploadAndHostImages(imageFiles, parentFolderId).pipe(
            switchMap(hostedImages => {
              const requests = this.buildFormRequests(parsedQuiz.items, hostedImages);
              const expectedStats = this.getFormRequestStats(requests);
              console.log(`[QTI Service] Prepared "${formTitle}" for Forms:`, expectedStats);
              const description = this.buildFormDescription(parsedQuiz.description, parsedQuiz.warnings, expectedStats);

              return this.createAndPopulateForm(formTitle, description, requests, expectedStats).pipe(
                switchMap(form => this.moveAndTagForm(form, parentFolderId, hashedItemId)),
                switchMap(form => this.releaseHostedImages(hostedImages).pipe(map(() => form))),
                catchError(error => this.releaseHostedImages(hostedImages).pipe(
                  switchMap(() => throwError(() => error))
                ))
              );
            })
          );
        })
      )),
      map(form => {
        if ((form as Material).form) return form as Material;
        const googleForm = form as GoogleForm;
        if (!googleForm?.formId) return null;
        return {
          form: {
            formUrl: googleForm.responderUri || `https://docs.google.com/forms/d/${googleForm.formId}/viewform`,
            title: googleForm.info?.title || formTitle
          }
        } as Material;
      }),
      catchError(error => {
        console.error(`[QTI Service] Failed to convert "${formTitle}":`, error);
        return throwError(() => new Error(
          `Google Form creation failed for "${formTitle}": ${error?.error?.error?.message || error?.message || String(error)}`
        ));
      })
    );
  }

  private selectBestQtiCandidate(
    qtiFile: ImsccFile,
    allPackageFiles: ImsccFile[],
    formTitle: string
  ): ParsedQtiCandidate {
    const primary = this.toParsedQtiCandidate(qtiFile, allPackageFiles, formTitle);
    const normalizedTargetTitle = this.normalizeTitleForMatch(primary.title || formTitle);
    const candidates = allPackageFiles
      .filter(file => file !== qtiFile && this.isLikelyQtiXml(file))
      .map(file => ({file, title: this.extractQtiAssessmentTitle(file) || ''}))
      .filter(candidate => this.normalizeTitleForMatch(candidate.title) === normalizedTargetTitle)
      .map(candidate => this.tryParsedQtiCandidate(candidate.file, allPackageFiles, candidate.title || formTitle))
      .filter((candidate): candidate is ParsedQtiCandidate => !!candidate)
      .filter(candidate => this.normalizeTitleForMatch(candidate.title) === normalizedTargetTitle);

    return [primary, ...candidates].reduce((best, candidate) =>
      this.compareQtiCandidates(candidate, best) > 0 ? candidate : best
    );
  }

  private toParsedQtiCandidate(
    file: ImsccFile,
    allPackageFiles: ImsccFile[],
    fallbackTitle: string
  ): ParsedQtiCandidate {
    const parsedQuiz = this.parseCanvasQti(file, allPackageFiles);
    const title = this.extractQtiAssessmentTitle(file) || fallbackTitle;
    return {
      file,
      parsedQuiz,
      title,
      stats: this.getParsedQuizStats(parsedQuiz)
    };
  }

  private tryParsedQtiCandidate(
    file: ImsccFile,
    allPackageFiles: ImsccFile[],
    fallbackTitle: string
  ): ParsedQtiCandidate | null {
    try {
      return this.toParsedQtiCandidate(file, allPackageFiles, fallbackTitle);
    } catch {
      return null;
    }
  }

  private isLikelyQtiXml(file: ImsccFile): boolean {
    if (!file?.data || typeof file.data !== 'string') return false;
    const name = file.name?.toLowerCase() || '';
    if (!name.endsWith('.xml') && file.mimeType !== 'text/xml' && file.mimeType !== 'application/xml') return false;
    return /<questestinterop\b|<assessment\b/i.test(file.data);
  }

  private extractQtiAssessmentTitle(file: ImsccFile): string | null {
    if (!file?.data || typeof file.data !== 'string') return null;
    try {
      const doc = new DOMParser().parseFromString(file.data, 'application/xml');
      if (doc.querySelector('parsererror')) return null;
      const assessment = Array.from(doc.getElementsByTagName('*'))
        .find(element => element.localName === 'assessment');
      return assessment?.getAttribute('title')?.trim() || null;
    } catch {
      return null;
    }
  }

  private normalizeTitleForMatch(title: string): string {
    return this.cleanText(title)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getParsedQuizStats(parsedQuiz: ParsedQuiz): FormConversionStats {
    const questionItems = parsedQuiz.items.filter(item => !!item.question);
    return {
      itemCount: parsedQuiz.items.length,
      questionCount: questionItems.length,
      totalPoints: questionItems.reduce((total, item) => total + (item.question?.grading?.pointValue || 0), 0),
      dropdownCount: questionItems.filter(item => item.question?.choiceQuestion?.type === 'DROP_DOWN').length
    };
  }

  private compareQtiCandidates(candidate: ParsedQtiCandidate, best: ParsedQtiCandidate): number {
    const candidateScore = candidate.stats.questionCount + candidate.stats.dropdownCount * 2;
    const bestScore = best.stats.questionCount + best.stats.dropdownCount * 2;
    return candidateScore - bestScore;
  }

  private parseCanvasQti(qtiFile: ImsccFile, allPackageFiles: ImsccFile[]): ParsedQuiz {
    const parser = new DOMParser();
    const doc = parser.parseFromString(qtiFile.data as string, 'application/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error(`Failed to parse QTI XML: ${parseError.textContent || 'unknown XML error'}`);
    }

    const fileIndex = this.buildPackageFileIndex(allPackageFiles);
    const warnings: string[] = [];
    const items: ParsedFormItem[] = [];
    const assessmentMeta = this.findAssessmentMetadata(qtiFile.name, allPackageFiles);
    const description = assessmentMeta ? this.extractQuizDescription(assessmentMeta) : '';

    Array.from(doc.getElementsByTagName('item')).forEach((item, itemIndex) => {
      const questionType = this.getMetadataValue(item, 'question_type') || 'unknown';
      const sourcePoints = this.parsePoints(this.getMetadataValue(item, 'points_possible'));
      const promptElement = item.querySelector('presentation > material > mattext');
      const promptHtml = promptElement?.textContent ? decode(promptElement.textContent) : '';
      const prompt = this.parseRichText(promptHtml, qtiFile.name, fileIndex, warnings);
      const fallbackTitle = item.getAttribute('title') || `Question ${itemIndex + 1}`;
      const promptLabel = this.buildPromptLabel(prompt.text, fallbackTitle, itemIndex);
      const promptDescription = this.buildPromptDescription(prompt.text, promptLabel);

      if (questionType === 'text_only_question') {
        items.push({
          kind: 'text',
          title: promptLabel,
          description: promptDescription,
          image: prompt.images[0]
        });
        return;
      }

      const presentation = item.querySelector('presentation');
      if (!presentation) {
        warnings.push(`Skipped "${fallbackTitle}": no QTI presentation block.`);
        return;
      }

      const responses = this.getPresentationResponses(presentation);
      if (responses.length === 0) {
        items.push({
          kind: 'question',
          title: promptLabel,
          description: promptDescription,
          question: this.textQuestion(true, sourcePoints)
        });
        return;
      }

      const isCompound = responses.length > 1 ||
        questionType === 'multiple_dropdowns_question' ||
        questionType === 'fill_in_multiple_blanks_question' ||
        questionType === 'matching_question';

      responses.forEach((response, responseIndex) => {
        const responseId = response.getAttribute('ident') || `response_${responseIndex + 1}`;
        const labelElement = response.querySelector(':scope > material > mattext');
        const responseLabel = this.cleanText(labelElement?.textContent || '');
        const title = isCompound
          ? this.buildCompoundQuestionTitle(promptLabel, responseLabel, responseId, responseIndex)
          : promptLabel;
        const points = isCompound ? 1 : sourcePoints;
        const formItem = this.parseResponse(
          item,
          response,
          questionType,
          responseId,
          title,
          points,
          qtiFile.name,
          fileIndex,
          warnings
        );

        if (formItem) {
          formItem.description = promptDescription;
          formItem.image = prompt.images[0];
          items.push(formItem);
        } else {
          warnings.push(`Skipped unsupported response "${responseId}" in "${fallbackTitle}".`);
        }
      });
    });

    if (items.length === 0) {
      warnings.push('No convertible questions were found in this quiz.');
    }
    return {description, items, warnings};
  }

  private buildPromptLabel(promptText: string, fallbackTitle: string, itemIndex: number): string {
    const cleanPrompt = this.cleanText(promptText);
    const cleanFallback = this.cleanText(fallbackTitle);
    const fallbackIsGeneric = !cleanFallback || /^question$/i.test(cleanFallback);
    const base = cleanPrompt || cleanFallback || `Question ${itemIndex + 1}`;
    const preferred = !fallbackIsGeneric && cleanPrompt.length > 180 ? cleanFallback : base;
    return this.truncateText(preferred, 120) || `Question ${itemIndex + 1}`;
  }

  private getFormCacheKey(itemId: string): string {
    return `${this.FORM_CONVERSION_VERSION}|${itemId}`;
  }

  private getPresentationResponses(presentation: Element): Element[] {
    return Array.from(presentation.getElementsByTagName('*')).filter(element =>
      element.localName === 'response_lid' || element.localName === 'response_str'
    );
  }

  private buildPromptDescription(promptText: string, promptLabel: string): string | undefined {
    const cleanPrompt = this.cleanText(promptText);
    if (!cleanPrompt || cleanPrompt === promptLabel) return undefined;
    return this.truncateText(cleanPrompt, 4000);
  }

  private truncateText(value: string, maxLength: number): string {
    const clean = this.cleanText(value);
    if (clean.length <= maxLength) return clean;
    const truncated = clean.slice(0, Math.max(0, maxLength - 1)).trimEnd();
    return `${truncated}...`;
  }

  private parseResponse(
    item: Element,
    response: Element,
    questionType: string,
    responseId: string,
    title: string,
    points: number,
    qtiFilePath: string,
    fileIndex: Map<string, ImsccFile>,
    warnings: string[]
  ): ParsedFormItem | null {
    const renderChoice = response.querySelector('render_choice');
    if (renderChoice) {
      const options = Array.from(renderChoice.querySelectorAll('response_label')).map((choice, index) =>
        this.parseChoice(choice, index, qtiFilePath, fileIndex, warnings)
      );
      const usableOptions = options.filter(option => option.value || option.image);
      if (usableOptions.length === 0) return null;

      if (this.arePlaceholderOnlyOptions(usableOptions)) {
        warnings.push(
          `Converted "${title}" to a paragraph response because Canvas exported only duplicate placeholder answers.`
        );
        const question = this.textQuestion(true, points);
        delete question.grading;
        return {kind: 'question', title, question};
      }

      const uniqueOptions = this.makeOptionValuesUnique(usableOptions, title, warnings);
      const choiceType = questionType === 'multiple_answers_question'
        ? 'CHECKBOX'
        : (questionType === 'multiple_dropdowns_question' || questionType === 'matching_question')
          ? 'DROP_DOWN'
          : 'RADIO';
      const correctIds = this.findCorrectAnswerIdentifiers(item, responseId);
      const correctValues = uniqueOptions
        .filter(option => correctIds.includes(option.identifier))
        .map(option => option.value);
      const formOptions: Option[] = uniqueOptions.map(option => ({value: option.value}));
      const optionImages = new Map<string, ImageReference>();
      uniqueOptions.forEach(option => {
        if (option.image) optionImages.set(option.value, option.image);
      });

      const question: Question = {
        required: true,
        choiceQuestion: {
          type: choiceType,
          options: formOptions,
          shuffle: renderChoice.getAttribute('shuffle') === 'yes'
        },
        grading: {
          pointValue: points,
          ...(correctValues.length > 0
            ? {correctAnswers: {answers: correctValues.map(value => ({value}))}}
            : {})
        }
      };
      return {kind: 'question', title, question, optionImages};
    }

    if (response.localName === 'response_str') {
      const isEssay = questionType === 'essay_question';
      const correctAnswers = this.findCorrectAnswerIdentifiers(item, responseId);
      const question = this.textQuestion(isEssay, points, correctAnswers);
      if (isEssay && correctAnswers.length === 0) {
        delete question.grading;
        warnings.push(`Essay question "${title}" requires manual point assignment in Google Forms.`);
      }
      if (questionType === 'numerical_question') {
        warnings.push(`Numerical question "${title}" uses exact-answer grading; Canvas tolerances are not supported by Google Forms.`);
      }
      return {kind: 'question', title, question};
    }
    return null;
  }

  private arePlaceholderOnlyOptions(options: ParsedOption[]): boolean {
    if (options.length < 2 || options.some(option => option.image)) return false;
    const normalizedValues = options.map(option => this.cleanText(option.value).toLowerCase());
    return new Set(normalizedValues).size === 1 &&
      /^(no answer text provided\.?|option \d+|image option)$/i.test(normalizedValues[0]);
  }

  private makeOptionValuesUnique(
    options: ParsedOption[],
    questionTitle: string,
    warnings: string[]
  ): ParsedOption[] {
    const counts = new Map<string, number>();
    const totals = new Map<string, number>();
    options.forEach(option => {
      const key = this.cleanText(option.value).toLowerCase();
      totals.set(key, (totals.get(key) || 0) + 1);
    });

    let changed = false;
    const uniqueOptions = options.map(option => {
      const key = this.cleanText(option.value).toLowerCase();
      const occurrence = (counts.get(key) || 0) + 1;
      counts.set(key, occurrence);
      if ((totals.get(key) || 0) < 2) return option;
      changed = true;
      return {...option, value: `${option.value} (Choice ${occurrence})`};
    });

    if (changed) {
      warnings.push(`Added choice numbers to duplicate answers in "${questionTitle}" so Google Forms can accept them.`);
    }
    return uniqueOptions;
  }

  private parseChoice(
    choice: Element,
    index: number,
    qtiFilePath: string,
    fileIndex: Map<string, ImsccFile>,
    warnings: string[]
  ): ParsedOption {
    const identifier = choice.getAttribute('ident') || choice.getAttribute('identifier') || `choice_${index + 1}`;
    const mattext = choice.querySelector('material > mattext, mattext');
    const rawContent = mattext?.textContent ? decode(mattext.textContent) : '';
    const parsed = this.parseRichText(rawContent, qtiFilePath, fileIndex, warnings);
    return {
      identifier,
      value: parsed.text || `Option ${index + 1}`,
      image: parsed.images[0]
    };
  }

  private textQuestion(paragraph: boolean, points: number, answers: string[] = []): Question {
    return {
      required: true,
      textQuestion: {paragraph},
      grading: {
        pointValue: points,
        ...(answers.length > 0
          ? {correctAnswers: {answers: answers.map(value => ({value}))}}
          : {})
      }
    };
  }

  private findCorrectAnswerIdentifiers(item: Element, responseId: string): string[] {
    const answers = new Set<string>();
    Array.from(item.querySelectorAll('respcondition')).forEach(condition => {
      const score = Number(condition.querySelector('setvar')?.textContent || '0');
      if (score <= 0) return;
      Array.from(condition.querySelectorAll('varequal')).forEach(value => {
        const referencedResponse = value.getAttribute('respident');
        if (!referencedResponse || referencedResponse === responseId) {
          const answer = this.cleanText(value.textContent || '');
          if (answer) answers.add(answer);
        }
      });
    });
    return Array.from(answers);
  }

  private parseRichText(
    html: string,
    qtiFilePath: string,
    fileIndex: Map<string, ImsccFile>,
    warnings: string[]
  ): {text: string; images: ImageReference[]} {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html || '', 'text/html');
    const images = Array.from(doc.querySelectorAll('img')).map((img): ImageReference | null => {
      const source = img.getAttribute('src') || '';
      const altText = img.getAttribute('alt') || 'Question image';
      const file = this.resolvePackageImage(source, qtiFilePath, fileIndex, altText);
      if (!file && source && this.isPrivateCanvasImageUrl(source)) {
        warnings.push(`Skipped inaccessible Canvas image not found in package: ${altText}`);
        return null;
      }
      if (!file && source && !/^https?:\/\//i.test(source)) {
        warnings.push(`Image not found in package: ${source}`);
      }
      return {source, altText, ...(file ? {file} : {})};
    }).filter((image): image is ImageReference => image !== null && !!image.source);

    doc.querySelectorAll('img').forEach(img => img.remove());
    return {
      text: this.cleanText(doc.body.textContent || html),
      images
    };
  }

  private buildPackageFileIndex(files: ImsccFile[]): Map<string, ImsccFile> {
    const index = new Map<string, ImsccFile>();
    files.forEach(file => {
      const normalized = this.normalizePackagePath(file.name);
      index.set(normalized, file);
      const basename = normalized.split('/').pop();
      if (basename && !index.has(`basename:${basename}`)) {
        index.set(`basename:${basename}`, file);
      }
    });
    return index;
  }

  private resolvePackageImage(
    source: string,
    qtiFilePath: string,
    fileIndex: Map<string, ImsccFile>,
    altText?: string
  ): ImsccFile | undefined {
    if (!source) return undefined;
    if (/^https?:\/\//i.test(source)) {
      if (!this.isPrivateCanvasImageUrl(source)) return undefined;
      const altBasename = this.normalizePackagePath(altText || '').split('/').pop();
      return altBasename ? fileIndex.get(`basename:${altBasename}`) : undefined;
    }
    let path = source.split(/[?#]/)[0];
    let fromRoot = false;
    if (path.startsWith('$IMS-CC-FILEBASE$')) {
      path = path.substring('$IMS-CC-FILEBASE$'.length).replace(/^[/\\]+/, '');
      fromRoot = true;
    } else if (path.startsWith('/')) {
      path = path.replace(/^[/\\]+/, '');
      fromRoot = true;
    }

    const decoded = this.normalizePackagePath(path);
    const qtiDirectory = this.normalizePackagePath(this.utils.getDirectory(qtiFilePath));
    const candidates = fromRoot
      ? [decoded]
      : [this.normalizePackagePath(`${qtiDirectory}/${decoded}`), decoded];

    for (const candidate of candidates) {
      const exact = fileIndex.get(candidate);
      if (exact) return exact;
    }
    return fileIndex.get(`basename:${decoded.split('/').pop() || decoded}`);
  }

  private isPrivateCanvasImageUrl(source: string): boolean {
    try {
      const url = new URL(source);
      return /(^|\.)instructure\.com$/i.test(url.hostname) &&
        (/\/assessment_questions\/.*\/files\/\d+(?:\/download)?/i.test(url.pathname) ||
          /\/files\/\d+(?:\/download)?/i.test(url.pathname) ||
          /\/api\/v1\/.*\/files\/\d+/i.test(url.pathname));
    } catch {
      return false;
    }
  }

  private normalizePackagePath(path: string): string {
    const clean = path.split(/[?#]/)[0].replace(/\\/g, '/').replace(/^\/+/, '');
    const decoded = this.utils.tryDecodeURIComponent(clean).replace(/\\/g, '/');
    const parts: string[] = [];
    decoded.split('/').forEach(part => {
      if (!part || part === '.') return;
      if (part === '..') parts.pop();
      else parts.push(part);
    });
    return parts.join('/').toLowerCase();
  }

  private collectUniqueImageFiles(items: ParsedFormItem[]): ImsccFile[] {
    const unique = new Map<string, ImsccFile>();
    items.forEach(item => {
      if (item.image?.file) unique.set(item.image.file.name, item.image.file);
      item.optionImages?.forEach(image => {
        if (image.file) unique.set(image.file.name, image.file);
      });
    });
    return Array.from(unique.values());
  }

  private uploadAndHostImages(files: ImsccFile[], parentFolderId: string): Observable<Map<string, HostedImage>> {
    if (files.length === 0) return of(new Map());
    const uploadInput = files.map(file => ({
      file,
      targetFileName: this.utils.getBasename(file.name) || 'quiz-image'
    }));

    return this.fileUploadService.uploadLocalFiles(uploadInput, parentFolderId).pipe(
      switchMap(uploaded => {
        const hostRequests = uploaded.map((driveFile, index) =>
          this.createTemporaryPublicPermission(driveFile).pipe(
            map(permissionId => ({
              originalFile: files[index],
              driveFile,
              permissionId,
              sourceUri: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveFile.id)}`
            } as HostedImage))
          )
        );
        return hostRequests.length ? forkJoin(hostRequests) : of([]);
      }),
      map(hosted => new Map(hosted.map(image => [image.originalFile.name, image])))
    );
  }

  private createTemporaryPublicPermission(file: DriveFile): Observable<string> {
    const headers = this.createHeaders();
    if (!headers) return throwError(() => new Error('Authentication token missing for image hosting.'));
    const url = `${this.utils.DRIVE_API_FILES_ENDPOINT}/${file.id}/permissions`;
    const params = new HttpParams().set('fields', 'id');
    return this.http.post<{id: string}>(url, {
      type: 'anyone',
      role: 'reader',
      allowFileDiscovery: false
    }, {headers, params}).pipe(map(permission => permission.id));
  }

  private releaseHostedImages(hostedImages: Map<string, HostedImage>): Observable<void> {
    const hosted = Array.from(hostedImages.values());
    if (hosted.length === 0) return of(undefined);
    const headers = this.createHeaders();
    if (!headers) return of(undefined);

    return forkJoin(hosted.map(image => {
      const url = `${this.utils.DRIVE_API_FILES_ENDPOINT}/${image.driveFile.id}/permissions/${image.permissionId}`;
      return this.http.delete(url, {headers}).pipe(
        catchError(error => {
          console.warn(`[QTI Service] Could not revoke temporary image permission for ${image.driveFile.name}.`, error);
          return of(null);
        })
      );
    })).pipe(map(() => undefined));
  }

  private buildFormRequests(
    items: ParsedFormItem[],
    hostedImages: Map<string, HostedImage>
  ): FormRequest[] {
    return items.flatMap((item, index) => {
      const formItem = this.toFormItem(item, hostedImages);
      if (!formItem) return [];
      return [{createItem: {item: formItem, location: {index}}}];
    });
  }

  private getFormRequestStats(requests: FormRequest[]): FormConversionStats {
    const formItems = requests
      .map(request => request.createItem?.item)
      .filter((item): item is FormItem => !!item);
    const questionItems = formItems.filter(item => !!item.questionItem?.question);
    return this.getFormItemStats(formItems, questionItems);
  }

  private getFormItemStats(
    formItems: FormItem[],
    questionItems = formItems.filter(item => !!item.questionItem?.question)
  ): FormConversionStats {
    return {
      itemCount: formItems.length,
      questionCount: questionItems.length,
      totalPoints: questionItems.reduce((total, item) =>
        total + (item.questionItem?.question?.grading?.pointValue || 0), 0),
      dropdownCount: questionItems.filter(item =>
        item.questionItem?.question?.choiceQuestion?.type === 'DROP_DOWN'
      ).length
    };
  }

  private toFormItem(
    item: ParsedFormItem,
    hostedImages: Map<string, HostedImage>
  ): FormItem | null {
    const image = this.toFormsImage(item.image, hostedImages);
    if (item.kind === 'text') {
      if (image) {
        return {title: item.title, imageItem: {image}};
      }
      return {title: item.title, textItem: {}};
    }
    if (item.kind === 'image') {
      return image ? {title: item.title, imageItem: {image}} : null;
    }
    if (!item.question) return null;

    if (item.question.choiceQuestion && item.optionImages) {
      item.question.choiceQuestion.options = item.question.choiceQuestion.options.map(option => ({
        ...option,
        image: this.toFormsImage(item.optionImages?.get(option.value), hostedImages, 'LEFT')
      }));
    }
    return {
      title: item.title,
      description: item.description,
      questionItem: {question: item.question, image}
    };
  }

  private toFormsImage(
    image: ImageReference | undefined,
    hostedImages: Map<string, HostedImage>,
    alignment: 'LEFT' | 'CENTER' | 'RIGHT' = 'CENTER'
  ): FormsImage | undefined {
    if (!image) return undefined;
    const sourceUri = image.file
      ? hostedImages.get(image.file.name)?.sourceUri
      : (/^https?:\/\//i.test(image.source) ? image.source : undefined);
    if (sourceUri && this.isPrivateCanvasImageUrl(sourceUri)) {
      console.warn(`[QTI Service] Skipping private Canvas image URL that was not resolved locally: ${sourceUri}`);
      return undefined;
    }
    return sourceUri ? {
      sourceUri,
      altText: image.altText || 'Question image',
      properties: {alignment}
    } : undefined;
  }

  private createAndPopulateForm(
    title: string,
    description: string,
    itemRequests: FormRequest[],
    expectedStats: FormConversionStats
  ): Observable<GoogleForm> {
    const headers = this.createHeaders();
    if (!headers) return throwError(() => new Error('Authentication token missing for Forms API.'));

    // forms.create accepts only info.title. Description and other metadata must
    // be applied afterward through forms.batchUpdate.
    const info: FormInfo = {title};
    return this.http.post<GoogleForm>(this.utils.FORMS_API_CREATE_ENDPOINT, {info}, {headers}).pipe(
      switchMap(form => {
        if (!form.formId) return throwError(() => new Error('Forms API did not return a form ID.'));
        const requests: FormRequest[] = [
          {
            updateSettings: {
              settings: {quizSettings: {isQuiz: true}},
              updateMask: 'quizSettings.isQuiz'
            }
          },
          ...(description ? [{
            updateFormInfo: {
              info: {description},
              updateMask: 'description'
            }
          } as FormRequest] : []),
          ...itemRequests
        ];
        return this.sendFormRequestChunks(form.formId, requests).pipe(
          switchMap(() => this.verifyCreatedForm(form.formId, expectedStats)),
          map(() => form)
        );
      }),
      switchMap(form => this.publishForm(form).pipe(map(() => form)))
    );
  }

  private verifyCreatedForm(formId: string, expectedStats: FormConversionStats): Observable<void> {
    const headers = this.createHeaders();
    if (!headers) return throwError(() => new Error('Authentication token missing for Forms verification.'));
    const url = `${this.utils.FORMS_API_GET_BASE_ENDPOINT}${formId}`;
    const params = new HttpParams()
      .set('fields', 'items(title,questionItem(question(choiceQuestion(type),grading(pointValue))))');
    return this.http.get<GoogleForm>(url, {headers, params}).pipe(
      map(form => {
        const actualStats = this.getFormItemStats(form.items || []);
        console.log(`[QTI Service] Verified Form ${formId}:`, {expectedStats, actualStats});
        const mismatches = [
          actualStats.questionCount === expectedStats.questionCount
            ? null
            : `questions expected ${expectedStats.questionCount}, got ${actualStats.questionCount}`,
          actualStats.dropdownCount === expectedStats.dropdownCount
            ? null
            : `dropdowns expected ${expectedStats.dropdownCount}, got ${actualStats.dropdownCount}`,
          actualStats.totalPoints === expectedStats.totalPoints
            ? null
            : `points expected ${expectedStats.totalPoints}, got ${actualStats.totalPoints}`
        ].filter((message): message is string => !!message);
        if (mismatches.length) {
          throw new Error(`Forms verification failed after creation: ${mismatches.join('; ')}.`);
        }
      })
    );
  }

  private sendFormRequestChunks(formId: string, requests: FormRequest[]): Observable<void> {
    const headers = this.createHeaders();
    if (!headers) return throwError(() => new Error('Authentication token missing for Forms API.'));
    const chunks: FormRequest[][] = [];
    for (let index = 0; index < requests.length; index += this.MAX_REQUESTS_PER_BATCH) {
      chunks.push(requests.slice(index, index + this.MAX_REQUESTS_PER_BATCH));
    }
    const url = `${this.utils.FORMS_API_BATCHUPDATE_BASE_ENDPOINT}${formId}:batchUpdate`;
    return from(chunks).pipe(
      concatMap(chunk => {
        const body: BatchUpdateFormRequest = {requests: chunk};
        return this.utils.retryRequest(
          this.http.post<BatchUpdateFormResponse>(url, body, {headers}),
          {maxRetries: 4, initialDelayMs: 1500},
          `Populate Form ${formId}`
        );
      }),
      reduce(() => undefined, undefined as void)
    );
  }

  private publishForm(form: GoogleForm): Observable<unknown> {
    const headers = this.createHeaders();
    if (!headers || !form.formId) return throwError(() => new Error('Cannot publish Form without authentication and form ID.'));
    const url = `${this.utils.FORMS_API_BATCHUPDATE_BASE_ENDPOINT}${form.formId}:setPublishSettings`;
    const body: SetPublishSettingsRequest = {
      publishSettings: {
        publishState: {
          isPublished: true,
          isAcceptingResponses: true
        }
      },
      updateMask: 'publishState'
    };
    return this.http.post(url, body, {headers});
  }

  private moveAndTagForm(
    form: GoogleForm,
    parentFolderId: string,
    hashedItemId: string
  ): Observable<GoogleForm> {
    const headers = this.createHeaders();
    if (!headers || !form.formId) return of(form);
    const url = `${this.utils.DRIVE_API_FILES_ENDPOINT}/${form.formId}`;
    const params = new HttpParams()
      .set('addParents', parentFolderId)
      .set('removeParents', 'root')
      .set('fields', 'id,name');
    return this.http.patch<DriveFile>(url, {
      appProperties: {[this.APP_PROPERTY_KEY]: hashedItemId}
    }, {headers, params}).pipe(
      map(file => ({
        ...form,
        info: {...form.info, title: file.name || form.info?.title || 'Quiz'}
      })),
      catchError(error => {
        console.warn(`[QTI Service] Form created but could not be moved/tagged.`, error);
        return of(form);
      })
    );
  }

  private findExistingForm(parentFolderId: string, hashedItemId: string): Observable<DriveFile | null> {
    const headers = this.createHeaders();
    if (!headers) return throwError(() => new Error('Authentication token missing for Drive search.'));
    const query = `'${parentFolderId}' in parents and appProperties has { key='${this.APP_PROPERTY_KEY}' and value='${this.utils.escapeQueryParam(hashedItemId)}' } and mimeType='application/vnd.google-apps.form' and trashed=false`;
    const params = new HttpParams()
      .set('q', query)
      .set('fields', 'files(id,name,mimeType,webViewLink)');
    return this.http.get<{files: DriveFile[]}>(this.utils.DRIVE_API_FILES_ENDPOINT, {headers, params}).pipe(
      map(result => result.files?.[0] || null)
    );
  }

  private findAssessmentMetadata(qtiPath: string, files: ImsccFile[]): ImsccFile | undefined {
    const directory = this.normalizePackagePath(this.utils.getDirectory(qtiPath));
    return files.find(file => this.normalizePackagePath(file.name) === `${directory}/assessment_meta.xml`);
  }

  private extractQuizDescription(file: ImsccFile): string {
    if (typeof file.data !== 'string') return '';
    const doc = new DOMParser().parseFromString(file.data, 'application/xml');
    const encoded = doc.getElementsByTagName('description')[0]?.textContent || '';
    return this.cleanText(new DOMParser().parseFromString(decode(encoded), 'text/html').body.textContent || '');
  }

  private getMetadataValue(item: Element, label: string): string | null {
    const fields = Array.from(item.querySelectorAll('qtimetadatafield'));
    const field = fields.find(candidate =>
      candidate.querySelector('fieldlabel')?.textContent?.trim().toLowerCase() === label.toLowerCase()
    );
    return field?.querySelector('fieldentry')?.textContent?.trim() || null;
  }

  private parsePoints(value: string | null): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.max(1, Math.round(parsed)) : 1;
  }

  private buildCompoundQuestionTitle(
    prompt: string,
    responseLabel: string,
    responseId: string,
    responseIndex: number
  ): string {
    const marker = responseLabel || responseId.replace(/^response_?/i, '') || `Part ${responseIndex + 1}`;
    const readableMarker = marker.replace(/^CLOZE_/i, 'Blank ').replace(/_/g, ' ');
    const cleanedPrompt = prompt.replace(/\[CLOZE_\d+\]/gi, '_____');
    return `${cleanedPrompt} (${readableMarker})`.trim();
  }

  private buildFormDescription(description: string, warnings: string[], stats: FormConversionStats): string {
    const summaryText = [
      'Conversion summary:',
      `- Generated ${stats.questionCount} quiz question(s), including ${stats.dropdownCount} dropdown question(s).`,
      `- Total quiz points: ${stats.totalPoints}.`
    ].join('\n');
    const uniqueWarnings = Array.from(new Set(warnings));
    const warningText = uniqueWarnings.length
      ? `\n\nConversion notes:\n${uniqueWarnings.map(warning => `- ${warning}`).join('\n')}`
      : '';
    return `${description ? `${description}\n\n` : ''}${summaryText}${warningText}`.trim();
  }

  private cleanText(value: string): string {
    return decode(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\s\u00a0]+/g, ' ')
      .trim();
  }

  private createHeaders(): HttpHeaders | null {
    const token = this.auth.getGoogleAccessToken();
    return token ? new HttpHeaders({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }) : null;
  }
}
