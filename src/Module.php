<?php

/**
 * Full Diagram module for webtrees.
 *
 * @license GPL-3.0-or-later
 */

declare(strict_types=1);

namespace FullDiagram;

use Fig\Http\Message\RequestMethodInterface;
use Fisharebest\Webtrees\Auth;
use Fisharebest\Webtrees\Contracts\UserInterface;
use Fisharebest\Webtrees\I18N;
use Fisharebest\Webtrees\Individual;
use Fisharebest\Webtrees\Menu;
use Fisharebest\Webtrees\Module\AbstractModule;
use Fisharebest\Webtrees\Module\ModuleBlockInterface;
use Fisharebest\Webtrees\Module\ModuleBlockTrait;
use Fisharebest\Webtrees\Module\ModuleChartInterface;
use Fisharebest\Webtrees\Module\ModuleChartTrait;
use Fisharebest\Webtrees\Module\ModuleCustomInterface;
use Fisharebest\Webtrees\Module\ModuleCustomTrait;
use Fisharebest\Webtrees\Registry;
use Fisharebest\Webtrees\Tree;
use Fisharebest\Webtrees\Validator;
use Fisharebest\Webtrees\View;
use FullDiagram\Facade\DataFacade;
use Illuminate\Support\Str;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

class Module extends AbstractModule implements ModuleChartInterface, ModuleCustomInterface, ModuleBlockInterface, RequestHandlerInterface
{
    use ModuleChartTrait;
    use ModuleCustomTrait;
    use ModuleBlockTrait;

    public const ROUTE_NAME = 'full-diagram';
    public const ROUTE_URL  = '/tree/{tree}/full-diagram/{xref}';

    private const DEFAULT_ANCESTOR_GENERATIONS   = 3;
    private const DEFAULT_DESCENDANT_GENERATIONS = 3;
    private const BLOCK_DEFAULT_ANCESTOR_GENS    = 3;
    private const BLOCK_DEFAULT_DESCENDANT_GENS  = 3;
    private const MINIMUM_GENERATIONS            = 1;
    private const MAXIMUM_GENERATIONS            = 10;

    public function title(): string
    {
        return I18N::translate('Full Diagram');
    }

    public function description(): string
    {
        return I18N::translate('An interactive diagram showing ancestors, descendants, and siblings.');
    }

    public function customModuleAuthorName(): string
    {
        return 'Alex';
    }

    public function customModuleVersion(): string
    {
        return '0.1.0';
    }

    public function customModuleSupportUrl(): string
    {
        return '';
    }

    public function resourcesFolder(): string
    {
        return __DIR__ . '/../resources/';
    }

    public function boot(): void
    {
        View::registerNamespace($this->name(), $this->resourcesFolder() . 'views/');

        Registry::routeFactory()->routeMap()
            ->get(self::ROUTE_NAME, self::ROUTE_URL, $this)
            ->allows(RequestMethodInterface::METHOD_POST);
    }

    // ─── Translations ────────────────────────────────────────────────

    public function customTranslations(string $language): array
    {
        $translations = [
            'de' => [
                'Full Diagram'                => 'Vollständiges Diagramm',
                'Full Diagram of %s'          => 'Vollständiges Diagramm von %s',
                'An interactive diagram showing ancestors, descendants, and siblings.' => 'Ein interaktives Diagramm mit Vorfahren, Nachkommen und Geschwistern.',
                'Show siblings'               => 'Geschwister anzeigen',
                'Born'                        => 'Geboren',
                'Baptism'                     => 'Taufe',
                'Marriage'                    => 'Heirat',
                'Died'                        => 'Gestorben',
                'Occupation'                  => 'Beruf',
                'Residence'                   => 'Wohnort',
                'View profile'                => 'Profil anzeigen',
                'Died at age %s'              => 'Gestorben im Alter von %s',
                'Deceased'                    => 'Verstorben',
                'Age ~%s'                     => 'Alter ~%s',
            ],
            'nl' => [
                'Full Diagram'                => 'Volledig diagram',
                'Full Diagram of %s'          => 'Volledig diagram van %s',
                'An interactive diagram showing ancestors, descendants, and siblings.' => 'Een interactief diagram met voorouders, nakomelingen en broers/zussen.',
                'Show siblings'               => 'Broers/zussen tonen',
                'Born'                        => 'Geboren',
                'Baptism'                     => 'Doop',
                'Marriage'                    => 'Huwelijk',
                'Died'                        => 'Overleden',
                'Occupation'                  => 'Beroep',
                'Residence'                   => 'Woonplaats',
                'View profile'                => 'Profiel bekijken',
                'Died at age %s'              => 'Overleden op %s-jarige leeftijd',
                'Deceased'                    => 'Overleden',
                'Age ~%s'                     => 'Leeftijd ~%s',
            ],
        ];

        return $translations[$language] ?? [];
    }

    // ─── Chart interface ─────────────────────────────────────────────

    public function chartMenuClass(): string
    {
        return 'menu-chart-full-diagram';
    }

    public function chartBoxMenu(Individual $individual): Menu|null
    {
        return $this->chartMenu($individual);
    }

    public function chartUrl(Individual $individual, array $parameters = []): string
    {
        return route(self::ROUTE_NAME, [
                'tree' => $individual->tree()->name(),
                'xref' => $individual->xref(),
            ] + $parameters);
    }

    public function chartTitle(Individual $individual): string
    {
        return I18N::translate('Full Diagram of %s', $individual->fullName());
    }

    // ─── Block interface ─────────────────────────────────────────────

    public function isTreeBlock(): bool
    {
        return true;
    }

    public function isUserBlock(): bool
    {
        return true;
    }

    public function loadAjax(): bool
    {
        return true;
    }

    public function getBlock(Tree $tree, int $block_id, string $context, array $config = []): string
    {
        $PEDIGREE_ROOT_ID = $tree->getPreference('PEDIGREE_ROOT_ID');
        $gedcomid         = $tree->getUserPreference(Auth::user(), UserInterface::PREF_TREE_ACCOUNT_XREF);
        $default_xref     = $gedcomid ?: $PEDIGREE_ROOT_ID;

        $xref                  = $this->getBlockSetting($block_id, 'pid', $default_xref);
        $ancestorGenerations   = (int) $this->getBlockSetting($block_id, 'ancestor_generations', (string) self::BLOCK_DEFAULT_ANCESTOR_GENS);
        $descendantGenerations = (int) $this->getBlockSetting($block_id, 'descendant_generations', (string) self::BLOCK_DEFAULT_DESCENDANT_GENS);
        $showSiblings          = $this->getBlockSetting($block_id, 'show_siblings', '1') === '1';

        $individual = Registry::individualFactory()->make($xref, $tree);

        if (!$individual instanceof Individual) {
            $content = I18N::translate('You must select an individual and a chart type in the block preferences');

            if ($context !== self::CONTEXT_EMBED) {
                return view('modules/block-template', [
                    'block'      => Str::kebab($this->name()),
                    'id'         => $block_id,
                    'config_url' => $this->configUrl($tree, $context, $block_id),
                    'title'      => $this->title(),
                    'content'    => $content,
                ]);
            }

            return $content;
        }

        $individual = Auth::checkIndividualAccess($individual, false, true);

        $configuration = new Configuration(
            $ancestorGenerations,
            $descendantGenerations,
            $showSiblings,
        );

        $dataFacade = new DataFacade();
        $treeData   = $dataFacade->buildFullTree($individual, $configuration);

        $title   = $this->chartTitle($individual);
        $content = view($this->name() . '::modules/full-diagram/block', [
            'module'                 => $this,
            'individual'             => $individual,
            'tree'                   => $tree,
            'tree_data'              => json_encode($treeData, JSON_THROW_ON_ERROR),
            'javascript_url'         => $this->assetUrl('js/full-diagram.min.js'),
            'stylesheet_url'         => $this->assetUrl('css/full-diagram.css'),
            'block_id'               => $block_id,
            'ancestor_generations'   => $ancestorGenerations,
            'descendant_generations' => $descendantGenerations,
            'show_siblings'          => $showSiblings,
        ]);

        if ($context !== self::CONTEXT_EMBED) {
            return view('modules/block-template', [
                'block'      => Str::kebab($this->name()),
                'id'         => $block_id,
                'config_url' => $this->configUrl($tree, $context, $block_id),
                'title'      => $title,
                'content'    => $content,
            ]);
        }

        return $content;
    }

    public function saveBlockConfiguration(ServerRequestInterface $request, int $block_id): void
    {
        $xref                  = Validator::parsedBody($request)->isXref()->string('xref');
        $ancestorGenerations   = Validator::parsedBody($request)->isBetween(self::MINIMUM_GENERATIONS, self::MAXIMUM_GENERATIONS)->integer('ancestor_generations');
        $descendantGenerations = Validator::parsedBody($request)->isBetween(self::MINIMUM_GENERATIONS, self::MAXIMUM_GENERATIONS)->integer('descendant_generations');
        $showSiblings          = Validator::parsedBody($request)->string('show_siblings', '0');

        $this->setBlockSetting($block_id, 'pid', $xref);
        $this->setBlockSetting($block_id, 'ancestor_generations', (string) $ancestorGenerations);
        $this->setBlockSetting($block_id, 'descendant_generations', (string) $descendantGenerations);
        $this->setBlockSetting($block_id, 'show_siblings', $showSiblings === '1' ? '1' : '0');
    }

    public function editBlockConfiguration(Tree $tree, int $block_id): string
    {
        $PEDIGREE_ROOT_ID = $tree->getPreference('PEDIGREE_ROOT_ID');
        $gedcomid         = $tree->getUserPreference(Auth::user(), UserInterface::PREF_TREE_ACCOUNT_XREF);
        $default_xref     = $gedcomid ?: $PEDIGREE_ROOT_ID;

        $xref                  = $this->getBlockSetting($block_id, 'pid', $default_xref);
        $ancestorGenerations   = (int) $this->getBlockSetting($block_id, 'ancestor_generations', (string) self::BLOCK_DEFAULT_ANCESTOR_GENS);
        $descendantGenerations = (int) $this->getBlockSetting($block_id, 'descendant_generations', (string) self::BLOCK_DEFAULT_DESCENDANT_GENS);
        $showSiblings          = $this->getBlockSetting($block_id, 'show_siblings', '1') === '1';

        $individual = Registry::individualFactory()->make($xref, $tree);

        return view($this->name() . '::modules/full-diagram/block-config', [
            'individual'             => $individual,
            'tree'                   => $tree,
            'ancestor_generations'   => $ancestorGenerations,
            'descendant_generations' => $descendantGenerations,
            'show_siblings'          => $showSiblings,
        ]);
    }

    // ─── Route handler ───────────────────────────────────────────────

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        $tree       = Validator::attributes($request)->tree();
        $xref       = Validator::attributes($request)->isXref()->string('xref');
        $individual = Registry::individualFactory()->make($xref, $tree);
        $individual = Auth::checkIndividualAccess($individual, false, true);

        // Redirect POST to GET for clean URLs
        if ($request->getMethod() === RequestMethodInterface::METHOD_POST) {
            $params = (array) $request->getParsedBody();

            return redirect($this->chartUrl($individual, [
                'ancestor_generations'   => $params['ancestor_generations'] ?? self::DEFAULT_ANCESTOR_GENERATIONS,
                'descendant_generations' => $params['descendant_generations'] ?? self::DEFAULT_DESCENDANT_GENERATIONS,
                'show_siblings'          => $params['show_siblings'] ?? '1',
            ]));
        }

        $ancestorGenerations   = Validator::queryParams($request)
            ->isBetween(self::MINIMUM_GENERATIONS, self::MAXIMUM_GENERATIONS)
            ->integer('ancestor_generations', self::DEFAULT_ANCESTOR_GENERATIONS);

        $descendantGenerations = Validator::queryParams($request)
            ->isBetween(self::MINIMUM_GENERATIONS, self::MAXIMUM_GENERATIONS)
            ->integer('descendant_generations', self::DEFAULT_DESCENDANT_GENERATIONS);

        $showSiblings = Validator::queryParams($request)
            ->string('show_siblings', '1') === '1';

        // Check for AJAX request
        $ajax = Validator::queryParams($request)->string('ajax', '') === '1';

        $configuration = new Configuration(
            $ancestorGenerations,
            $descendantGenerations,
            $showSiblings,
        );

        $dataFacade = new DataFacade();
        $treeData   = $dataFacade->buildFullTree($individual, $configuration);

        if ($ajax) {
            return response([
                'data' => $treeData,
            ]);
        }

        return $this->viewResponse($this->name() . '::modules/full-diagram/page', [
            'title'                  => $this->chartTitle($individual),
            'individual'             => $individual,
            'module'                 => $this,
            'tree'                   => $tree,
            'configuration'          => $configuration,
            'tree_data'              => json_encode($treeData, JSON_THROW_ON_ERROR),
            'javascript_url'         => $this->assetUrl('js/full-diagram.min.js'),
            'stylesheet_url'         => $this->assetUrl('css/full-diagram.css'),
            'ancestor_generations'   => $ancestorGenerations,
            'descendant_generations' => $descendantGenerations,
            'show_siblings'          => $showSiblings,
            'max_generations'        => self::MAXIMUM_GENERATIONS,
            'min_generations'        => self::MINIMUM_GENERATIONS,
        ]);
    }
}
