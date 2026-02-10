import { useEffect, useState } from 'react';
import { getAccomplish } from '@/lib/accomplish';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { VERTEX_LOCATIONS } from './locations';

interface VertexAdcTabProps {
  projectId: string;
  location: string;
  onProjectIdChange: (projectId: string) => void;
  onLocationChange: (location: string) => void;
}

export function VertexAdcTab({
  projectId,
  location,
  onProjectIdChange,
  onLocationChange,
}: VertexAdcTabProps) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const accomplish = getAccomplish();

    accomplish
      .listVertexProjects()
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.projects.length > 0) {
          setProjects(
            result.projects.map((p) => ({
              id: p.projectId,
              name: p.name !== p.projectId ? `${p.projectId} (${p.name})` : p.projectId,
            }))
          );
          // Auto-select first project if none selected
          if (!projectId) {
            // Prefer the gcloud default project if available
            accomplish
              .detectVertexProject()
              .then((detected) => {
                if (cancelled) return;
                if (detected.success && detected.projectId) {
                  onProjectIdChange(detected.projectId);
                } else {
                  onProjectIdChange(result.projects[0].projectId);
                }
              })
              .catch(() => {
                if (!cancelled) onProjectIdChange(result.projects[0].projectId);
              });
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingProjects(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
        Uses credentials from <code className="text-xs bg-muted rounded px-1 py-0.5">gcloud auth application-default login</code>
      </div>

      {/* Project Selector */}
      <SearchableSelect
        items={projects}
        value={projectId || null}
        onChange={onProjectIdChange}
        label="Project"
        placeholder="Select a project..."
        searchPlaceholder="Search projects..."
        emptyMessage={loadingProjects ? 'Loading projects...' : 'No projects found'}
        loading={loadingProjects}
        loadingMessage="Fetching GCP projects from your account..."
        testId="vertex-adc-project"
      />

      {/* Location */}
      <SearchableSelect
        items={VERTEX_LOCATIONS}
        value={location}
        onChange={onLocationChange}
        label="Location"
        placeholder="Select location..."
        searchPlaceholder="Search locations..."
        emptyMessage="No locations found"
        testId="vertex-location-select"
      />
    </div>
  );
}
