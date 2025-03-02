// @flow

/**
 * `fs-selector` type prompt
 */

const rx = require('rx-lite');
const chalk = require('chalk');
const figures = require('figures');
const cliCursor = require('cli-cursor');
const Base = require('inquirer/lib/prompts/base');
const observe = require('inquirer/lib/utils/events');
const Paginator = require('inquirer/lib/utils/paginator');
const Choices = require('inquirer/lib/objects/choices');
const Separator = require('inquirer/lib/objects/separator');
const { filter, share, flatMap, map, take, takeUntil, tap } = require('rxjs/operators');
const rxjs = require('rxjs')

const path = require('path');
const fs = require('fs');

/**
 * The "current directory" identifier.
 */
const CURRENT = '.';

/**
 * The "previous directory" identifier.
 */
const BACK = '..';


/**
 *
 * @param {any} val
 * @param {string} expectedType
 * @param {any} fallbackVal
 * @returns {any} `val` if it has the type `expectedType`. `fallbackVal` otherwise.
 */
const getIfHasExpectedType = (val /*: any */, expectedType /*: string */, fallbackVal /*: any */) =>
  (typeof val === expectedType) ? val : fallbackVal;


class FSPrompt extends Base {

  constructor(
    questions /*: Array<any> */,
    rl /*: readline$Interface */,
    answers /*: Array<any> */
  ) {
    super(questions, rl, answers);

    const { options } = this.opt;

    // validate mandatory parameters
    if (typeof this.opt.basePath !== 'string') {
      this.throwParamError('basePath');
    }

    this.currentPath = path.isAbsolute(this.opt.basePath)
      ? path.resolve(this.opt.basePath)
      : path.resolve(process.cwd(), this.opt.basePath);

    // checks if `currentPath` is a valid directory
    if (fs.existsSync(this.currentPath)) {
      if (!fs.lstatSync(this.currentPath).isDirectory()) {
        throw new Error(`'${this.currentPath}' is not a directory`);
      }
    } else {
      throw new Error(`No such directory: '${this.currentPath}'`);
    }

    const defaultIcons = {
      currentDir: '\u{1F4C2}', // open file folder emoji
      dir: '\u{1F4C1}', // file folder emoji
      file: '\u{1F4C4}', // page facing up emoji
    };

    /* initialize options with default values */
    this.opt.default = getIfHasExpectedType(this.opt.default, 'string', CURRENT);
    this.opt.displayFiles = true;
    this.opt.displayHidden = false;
    this.opt.canSelectFile = true;
    this.opt.icons = defaultIcons;
    this.opt.showItem = undefined;

    if (typeof options === 'object') {
      this.opt.displayFiles = getIfHasExpectedType(options.displayFiles, 'boolean', this.opt.displayFiles);
      this.opt.displayHidden = getIfHasExpectedType(options.displayHidden, 'boolean', this.opt.displayHidden);
      this.opt.canSelectFile = getIfHasExpectedType(options.canSelectFile, 'boolean', this.opt.canSelectFile);
      this.opt.showItem = getIfHasExpectedType(options.showItem, 'function', this.opt.showItem);

      if (typeof options.icons === 'object') {
        Object.assign(this.opt.icons, options.icons);
      } else if (options.icons === false) {
        this.opt.icons = false
      }
    }

    this.root = path.parse(this.currentPath).root;

    this.opt.choices = new Choices(this.createChoices(), this.answers);
    const initialPointer = this.opt.choices.realChoices.findIndex(realChoice => realChoice.name === this.opt.default);
    this.selected = (initialPointer >= 0) ? initialPointer : 0;

    this.searchTerm = '';

    this.paginator = new Paginator();
  }

  /**
   * Start the Inquiry session
   * @param {Function} cb Callback when prompt is done
   * @returns {this}
   */
  _run(cb /*: Function */) /*: this */ {
    this.searchMode = false;
    this.done = cb;
    const alphaNumericRegex = /\w|\.|-/i;
    const events = observe(this.rl);

    const keyUps = events.keypress.pipe(
      filter(evt => evt.key.name === 'up'),
      share()
    );

    const keyDowns = events.keypress.pipe(
      filter(evt => evt.key.name === 'down'),
      share()
    );

    const keySlash = events.keypress.pipe(
      filter(evt => evt.value === '/' && !this.searchMode),
      share()
    );

    const keyMinus = events.keypress.pipe(
      filter(evt => evt.value === '-' && !this.searchMode),
      share()
    );

    const dotKey = events.keypress.pipe(
      filter(evt => evt.value === '.' && !this.searchMode),
      share()
    );

    const alphaNumeric = events.keypress.pipe(
      filter(evt => evt.key.name === 'backspace' || alphaNumericRegex.test(evt.value)),
      share()
    );

    const searchTerm = keySlash.pipe(
      flatMap(() => {
        this.searchMode = true;
        this.searchTerm = '';
        this.render();

        const end$ = new rxjs.Subject(); // https://rxjs-dev.firebaseapp.com/guide/subject
        const done$ = rxjs.merge(events.line, end$); // https://rxjs-dev.firebaseapp.com/api/index/function/merge

        return alphaNumeric.pipe(
          map((evt) => {
            if (evt.key.name === 'backspace' && this.searchTerm.length) {
              this.searchTerm = this.searchTerm.slice(0, -1);
            } else if (evt.value) {
              this.searchTerm += evt.value;
            }

            if (this.searchTerm === '') {
              end$.next(true);
            }

            return this.searchTerm;
          }),//</map>

          takeUntil(done$),

          tap({
            complete: () => {
              this.searchMode = false;
              this.render();
              return false;
            }
          })//</tap>
      );

      }),//</flatMap>
      share()
    );

    const outcome = this.handleSubmit(events.line);
    outcome.drill.forEach(this.handleDrill.bind(this));
    outcome.back.forEach(this.handleBack.bind(this));

    keyUps.pipe(
      takeUntil(outcome.done),
    ).forEach(this.onUpKey.bind(this));

    keyDowns.pipe(
      takeUntil(outcome.done),
    ).forEach(this.onDownKey.bind(this));

    keyMinus.pipe(
      takeUntil(outcome.done),
    ).forEach(this.handleBack.bind(this));

    dotKey.pipe(
      takeUntil(outcome.done),
    ).forEach(this.onSubmit.bind(this));

    events.keypress.pipe(
      takeUntil(outcome.done),
    ).forEach(this.hideKeyPress.bind(this));

    searchTerm.pipe(
      takeUntil(outcome.done),
    ).forEach(this.onKeyPress.bind(this));

    outcome.done.forEach(this.onSubmit.bind(this));

    // Hiding the cursor while prompting
    cliCursor.hide();
    // Initial rendering of the questions.
    this.render();

    return this;
  }

  /**
   * Render the prompt to screen
   * @param {string} [selectedPath]
   */
  render(selectedPath /*: ?string */) {
    // Render question
    let message = this.getQuestion();

    // Render choices or answer depending on the state
    if (this.status === 'answered') {
      if (selectedPath) {
        message += chalk.cyan(selectedPath);
      } else {
        return; // bypassing re-render
      }
    } else {
      updateChoices(this.opt.choices, this.currentPath);

      message += chalk.gray('\nCurrent directory: ') + chalk.gray.bold(path.resolve(this.opt.basePath, this.currentPath));
      message += chalk.dim('\n');

      const choicesStr = listRender(this.opt.choices, this.selected, this.opt.icons);
      message += '\n' + this.paginator.paginate(choicesStr, this.selected, this.opt.pageSize);

      if (this.searchMode) {
        message += ('\nSearch: ' + this.searchTerm);
      } else {
        message += chalk.dim('\n(Use "/" key to search this directory)');
        message += chalk.dim('\n(Use "-" key to navigate to the parent folder');
      }
    }

    this.screen.render(message);
  }

  /**
   * When user press `enter` key
   * @param {rxjs.Observable} e
   * @returns {{done, back, drill}}
   */
  handleSubmit(e /*: rxjs.Observable */) /*: ({done:rxjs.Observable, back:rxjs.Observable, drill:rxjs.Observable}) */ {
    const obx = e.pipe(
      map(() => this.opt.choices.getChoice(this.selected).value),
      share()
    );

    const done = obx.pipe(
      filter((choiceValue) => {
        const choice = this.opt.choices.getChoice(this.selected);//realmente necessário?
        return choiceValue === CURRENT || (this.opt.canSelectFile && choice.isFile);
      }),
      take(1)
    );

    const back = obx.pipe(
      filter(choiceValue => choiceValue === BACK),
      takeUntil(done)
    );

    const drill = obx.pipe(
      filter(choiceValue => choiceValue !== BACK && choiceValue !== CURRENT),
      takeUntil(done)
    );

    return {
      done,
      back,
      drill,
    };
  }

  /**
   * When user selects to drill
   * into a folder (by selecting folder name)
   */
  handleDrill() {
    const choice = this.opt.choices.getChoice(this.selected);
    if (!choice.isDirectory) return;

    this.currentPath = path.join(this.currentPath, choice.value);
    this.opt.choices = new Choices(this.createChoices(), this.answers);
    this.selected = 0;

    // Rerender prompt
    this.render();
  }

  /**
   * When user selects ".." to go back in directory tree
   */
  handleBack() {
    this.currentPath = path.dirname(this.currentPath);
    this.opt.choices = new Choices(this.createChoices(), this.answers);
    this.selected = 0;

    // Rerender prompt
    this.render();
  }

  /**
   * When user selects "." (`CURRENT`) or a file
   */
  onSubmit() {
    const choice = this.opt.choices.getChoice(this.selected);
    const selectedPath = path.resolve(this.opt.basePath, this.currentPath, choice.value);

    this.status = 'answered';

    // Rerender prompt
    this.render(selectedPath);

    this.screen.done();
    cliCursor.show();

    this.done({
      isDirectory: choice.isDirectory,
      isFile: choice.isFile,
      path: selectedPath,
    });
  }

  /**
   * When user press a key
   */
  hideKeyPress() {
    if (!this.searchMode) {
      this.render();
    }
  }

  /**
   * When an `up` key is released.
   */
  onUpKey() {
    const len = this.opt.choices.realLength;
    this.selected = (this.selected > 0) ? this.selected - 1 : len - 1;
    this.render();
  }

  /**
   * When a `down` key is pressed.
   */
  onDownKey() {
    const len = this.opt.choices.realLength;
    this.selected = (this.selected < len - 1) ? this.selected + 1 : 0;
    this.render();
  }

  /**
   * When the slash (`/`) key is pressed.
   */
  onSlashKey( /* evt */ ) {
    this.render();
  }

  /**
   * When a key is pressed.
   */
  onKeyPress( /* evt */ ) {
    for (let idx = 0; idx < this.opt.choices.realLength; ++idx) {
      let item = this.opt.choices.realChoices[idx].name.toLowerCase();
      if (item.indexOf(this.searchTerm) === 0) {
        this.selected = idx;
        break;
      }
    }

    this.render();
  }


  /**
   * Helper to create new choices based
   * on previous selection
   * @param {string} [basePath=this.currentPath]
   * @returns {Array<string>}
   */
  createChoices(basePath /*: ?string */) /*: Array<string> */ {
    basePath = basePath || this.currentPath;
    const directoryContent = getDirectoryContent(basePath, this.opt.displayHidden, this.opt.displayFiles, this.opt.showItem);

    if (basePath !== this.root) {
      directoryContent.unshift(BACK);
    }

    directoryContent.unshift(CURRENT);

    if (directoryContent.length > 0) {
      directoryContent.push(new Separator());
    }

    return directoryContent;
  }

}


/**
 * Function for rendering list choices
 * @param  {Choices} choices
 * @param  {number} pointerIdx Position of the pointer
 * @param  {{currentDir:string, dir:string, file:string}} [icons]
 * @return {string} Rendered content
 */
function listRender(
  choices /*: Choices */,
  pointerIdx /*: number */ ,
  icons /*: ?any */) /*: string */ {

  let output = '';
  let separatorOffset = 0;

  choices.forEach((choice, idx) => {
    if (choice.type === 'separator') {
      separatorOffset++;
      output += '  ' + choice + '\n';
      return;
    }

    const isSelected = (idx - separatorOffset) === pointerIdx;
    let line = isSelected ? figures.pointer + ' ' : '  ';

    if (icons) {
      if (choice.isDirectory) {
        if (choice.name === CURRENT) {
          line += icons.currentDir;
        } else {
          line += icons.dir;
        }
      } else if (choice.isFile) {
        line += icons.file;
      }

      line += ' ';
    }

    line += choice.name;

    if (isSelected) {
      line = chalk.cyan(line);
    }

    output += line + ' \n';
  });

  return output.replace(/\n$/, '');
}

/**
 * Function for getting list of folders in directory
 * @param  {string} basePath The path the folder to get a list of containing folders
 * @param  {boolean} [includeHidden=false] Set to `true` if you want to get hidden files
 * @param  {boolean} [includeFiles=false] Set to `true` if you want to get files
 * @return {string[]} Array of folder names inside of `basePath`
 */
function getDirectoryContent(
  basePath /*: string */,
  includeHidden /*: ?boolean */,
  includeFiles /*: ?boolean */,
  shouldIncludeFile /*: ?function */
) /*: Array<string> */ {

  return fs
    .readdirSync(basePath)
    .filter((file) => {
      try {
        const fullPath = path.join(basePath, file);
        const stats = fs.lstatSync(fullPath);
        if (stats.isSymbolicLink()) {
          return false;
        }

        const isDir = stats.isDirectory();
        const isFile = stats.isFile() && includeFiles;
        const isValidItem = (isDir || isFile) &&
          shouldIncludeFile ? shouldIncludeFile(isDir, isFile, fullPath) : true;

        if (includeHidden) {
          return isValidItem;
        }

        const isNotDotFile = path.basename(file).indexOf('.') !== 0;
        return isValidItem && isNotDotFile;
      } catch (err) {
        return false;
      }
    })
    .sort();
}

/**
 * Attach filesystem metadata to `choices` elements
 * @param {Choices} choices
 * @param {string} basePath
 */
function updateChoices(
  choices /*: Choices */,
  basePath /*: string */) {

  choices.forEach((choice, idx) => {
    if (choice.type !== undefined) return;
    try {
      const stats = fs.lstatSync( path.join(basePath, choice.value) );
      choice.isDirectory = stats.isDirectory();
      choice.isFile = stats.isFile();
      choices[idx] = choice;
    } catch (err) {
      // console.error(err);
    }
  });
}


/**
 * Module exports
 */
module.exports = FSPrompt;
